#!/usr/bin/env bash
# Ubuntu 24.04 LTS server bootstrap script.
#
# One-liner (download + apply):
#   curl -fsSL "https://pahaz.8iq.dev/sh/init.sh" | sudo bash

set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

if [[ ! -f /etc/os-release ]]; then
  echo "Cannot detect OS." >&2
  exit 1
fi

# shellcheck disable=SC1091
source /etc/os-release
if [[ "${ID:-}" != "ubuntu" ]]; then
  echo "This script supports Ubuntu only." >&2
  exit 1
fi
if [[ -z "${VERSION_ID:-}" ]]; then
  echo "Cannot detect Ubuntu version from /etc/os-release." >&2
  exit 1
fi
UBUNTU_MAJOR="${VERSION_ID%%.*}"
UBUNTU_MINOR="${VERSION_ID#*.}"
if [[ ! "${UBUNTU_MAJOR}" =~ ^[0-9]+$ ]]; then
  echo "Unsupported Ubuntu version format: ${VERSION_ID}" >&2
  exit 1
fi
if (( UBUNTU_MAJOR < 22 )); then
  echo "Ubuntu ${VERSION_ID} is too old. Use Ubuntu 22.04+." >&2
  exit 1
fi
if [[ "${UBUNTU_MINOR}" != "04" ]]; then
  echo "Warning: ${PRETTY_NAME:-unknown} is not an LTS .04 release; continuing." >&2
fi
if [[ "${VERSION_ID}" != "24.04" ]]; then
  echo "Warning: script is tested primarily on Ubuntu 24.04 LTS (detected ${PRETTY_NAME:-unknown})." >&2
fi

export DEBIAN_FRONTEND=noninteractive
SSH_KEY_URL="${SSH_KEY_URL:-https://github.com/pahaz.keys}"
AUDIT_EXAMPLE_DIRS=(
  "/usr/share/doc/auditd/examples/rules"
  "/usr/share/audit/sample-rules"
)

log() {
  if [[ -t 1 ]]; then
    # Highlight service messages in dense command output streams.
    printf '\n\033[1;36m[init]\033[0m \033[1m%s\033[0m\n' "$*"
  else
    printf '\n[init] ==> %s\n' "$*"
  fi
}

warn() {
  if [[ -t 2 ]]; then
    printf '\n\033[1;33m[init][warn]\033[0m \033[1m%s\033[0m\n' "$*" >&2
  else
    printf '\n[init][warn] ==> %s\n' "$*" >&2
  fi
}

secure_curl() {
  curl --proto '=https' -fsSL "$@"
}

has_deb_installed() {
  local package="$1"
  dpkg-query -W -f='${db:Status-Abbrev}' "${package}" 2>/dev/null | grep -q '^ii'
}

pick_unit_name() {
  local preferred="$1"
  local fallback="$2"

  if systemctl list-unit-files --type=service --no-legend 2>/dev/null | awk '{print $1}' | grep -qx "${preferred}.service"; then
    printf '%s\n' "${preferred}"
    return 0
  fi
  if systemctl list-unit-files --type=service --no-legend 2>/dev/null | awk '{print $1}' | grep -qx "${fallback}.service"; then
    printf '%s\n' "${fallback}"
    return 0
  fi
  printf '%s\n' "${preferred}"
}

write_file() {
  local path="$1"
  local mode="$2"
  local owner="$3"
  local group="$4"
  local tmp
  tmp="$(mktemp)"
  cat > "${tmp}"

  if [[ ! -f "${path}" ]] || ! cmp -s "${tmp}" "${path}"; then
    install -D -m "${mode}" -o "${owner}" -g "${group}" "${tmp}" "${path}"
    log "Updated ${path}"
  else
    log "No changes for ${path}"
  fi
  rm -f "${tmp}"
}

set_config_value() {
  local file="$1"
  local key="$2"
  local value="$3"

  if grep -Eq "^[[:space:]]*${key}[[:space:]]*=" "${file}"; then
    sed -i -E "s|^[[:space:]]*${key}[[:space:]]*=.*|${key} = ${value}|" "${file}"
  else
    printf '%s = %s\n' "${key}" "${value}" >> "${file}"
  fi
}

install_audit_example_rule() {
  local rule_name="$1"
  local src_dir
  local src_plain
  local src_gz
  local dst="/etc/audit/rules.d/${rule_name##*/}"
  local tmp

  for src_dir in "${AUDIT_EXAMPLE_DIRS[@]}"; do
    [[ -d "${src_dir}" ]] || continue
    src_plain="${src_dir}/${rule_name}"
    src_gz="${src_plain}.gz"
    tmp="$(mktemp)"
    if [[ -f "${src_plain}" ]]; then
      cp "${src_plain}" "${tmp}"
    elif [[ -f "${src_gz}" ]]; then
      gzip -dc "${src_gz}" > "${tmp}"
    else
      rm -f "${tmp}"
      continue
    fi

    if [[ ! -f "${dst}" ]] || ! cmp -s "${tmp}" "${dst}"; then
      install -D -m 0640 -o root -g root "${tmp}" "${dst}"
      log "Installed audit sample rule ${rule_name} from ${src_dir}"
    else
      log "Audit sample rule already up to date: ${rule_name}"
    fi
    rm -f "${tmp}"
    return 0
  done

  warn "auditd examples directory/rule missing for ${rule_name}"
  return 1
}

install_any_audit_example_rule() {
  local label="$1"
  shift
  local candidate
  local selected=""
  local src_dir

  for candidate in "$@"; do
    for src_dir in "${AUDIT_EXAMPLE_DIRS[@]}"; do
      [[ -d "${src_dir}" ]] || continue
      if [[ -f "${src_dir}/${candidate}" || -f "${src_dir}/${candidate}.gz" ]]; then
        selected="${candidate}"
        break 2
      fi
    done
  done

  for candidate in "$@"; do
    if [[ "${candidate}" != "${selected}" ]]; then
      local dst="/etc/audit/rules.d/${candidate##*/}"
      if [[ -f "${dst}" ]]; then
        rm -f "${dst}"
        log "Removed obsolete audit rule candidate: ${dst}"
      fi
    fi
  done

  if [[ -n "${selected}" ]] && install_audit_example_rule "${selected}"; then
    log "Using audit sample for ${label}: ${selected}"
    return 0
  fi

  warn "Could not find a suitable audit sample for ${label}"
  return 1
}

fetch_primary_ssh_key() {
  local key
  if [[ ! "${SSH_KEY_URL}" =~ ^https:// ]]; then
    echo "SSH_KEY_URL must use https:// (got: ${SSH_KEY_URL})" >&2
    return 1
  fi
  key="$(secure_curl "${SSH_KEY_URL}" | sed '/^\s*$/d' | head -n 1)"
  if [[ -z "${key}" ]]; then
    echo "Failed to fetch SSH key from ${SSH_KEY_URL}" >&2
    return 1
  fi
  if [[ ! "${key}" =~ ^ssh-(rsa|ed25519|ecdsa) ]]; then
    echo "Fetched key has unexpected format: ${key}" >&2
    return 1
  fi
  printf '%s\n' "${key}"
}

ensure_key_in_authorized_keys() {
  local username="$1"
  local key="$2"
  local home_dir
  local auth_file

  home_dir="$(getent passwd "${username}" | cut -d: -f6)"
  if [[ -z "${home_dir}" ]]; then
    echo "Cannot detect home directory for ${username}" >&2
    return 1
  fi

  install -d -m 0700 -o "${username}" -g "${username}" "${home_dir}/.ssh"
  auth_file="${home_dir}/.ssh/authorized_keys"
  touch "${auth_file}"
  chown "${username}:${username}" "${auth_file}"
  chmod 0600 "${auth_file}"

  if grep -Fqx -- "${key}" "${auth_file}" >/dev/null 2>&1; then
    log "Key already present for ${username}"
  else
    printf '%s\n' "${key}" >> "${auth_file}"
    log "Added key for ${username}"
  fi
}

warn_if_other_keys_present() {
  local username="$1"
  local expected_key="$2"
  local home_dir
  local auth_file

  home_dir="$(getent passwd "${username}" | cut -d: -f6)"
  if [[ -z "${home_dir}" ]]; then
    return 0
  fi
  auth_file="${home_dir}/.ssh/authorized_keys"
  if [[ ! -f "${auth_file}" ]]; then
    return 0
  fi

  local other_count
  other_count="$(
    awk -v key="${expected_key}" '
      /^[[:space:]]*$/ { next }
      /^[[:space:]]*#/ { next }
      $0 != key { c++ }
      END { print c + 0 }
    ' "${auth_file}"
  )"
  if [[ "${other_count}" -gt 0 ]]; then
    warn "User ${username} has ${other_count} additional SSH key(s) in ${auth_file}"
  fi
}

configure_root_ssh_key() {
  local key="$1"
  ensure_key_in_authorized_keys "root" "${key}"
  warn_if_other_keys_present "root" "${key}"
}

force_time_sync() {
  local synced="no"
  local attempt=0
  local max_attempts=20
  local ntp_unit=""

  # Prefer distro-default timesyncd, but fall back to chrony when present.
  if systemctl list-unit-files --type=service --no-legend 2>/dev/null | awk '{print $1}' | grep -qx 'systemd-timesyncd.service'; then
    ntp_unit="systemd-timesyncd"
  elif systemctl list-unit-files --type=service --no-legend 2>/dev/null | awk '{print $1}' | grep -qx 'chrony.service'; then
    ntp_unit="chrony"
  fi

  if ! timedatectl set-ntp true 2>/dev/null; then
    warn "Failed to enable NTP via timedatectl; trying service-level start"
  fi

  if [[ -n "${ntp_unit}" ]]; then
    if ! systemctl enable --now "${ntp_unit}" 2>/dev/null; then
      warn "Failed to enable/start ${ntp_unit}.service"
    fi
    if ! systemctl restart "${ntp_unit}" 2>/dev/null; then
      warn "Failed to restart ${ntp_unit}.service"
    fi
  else
    warn "No known NTP service unit found (systemd-timesyncd/chrony)"
  fi

  while [[ "${attempt}" -lt "${max_attempts}" ]]; do
    if [[ "$(timedatectl show -p NTPSynchronized --value 2>/dev/null || true)" == "yes" ]]; then
      synced="yes"
      break
    fi
    sleep 1
    attempt=$((attempt + 1))
  done

  if [[ "${synced}" == "yes" ]]; then
    log "Time synchronization is active (NTP synchronized)"
  else
    warn "Time sync was enabled but not yet synchronized; check network/NTP reachability"
  fi
}

assert_root_ssh_access_preflight() {
  local expected_key="$1"
  local auth_file="/root/.ssh/authorized_keys"

  if [[ ! -f "${auth_file}" ]]; then
    echo "Root authorized_keys is missing at ${auth_file}" >&2
    return 1
  fi
  if ! grep -Fqx -- "${expected_key}" "${auth_file}" >/dev/null 2>&1; then
    echo "Expected root SSH key is missing in ${auth_file}" >&2
    return 1
  fi
}

warn_if_other_ssh_login_users_exist() {
  local user
  local uid
  local shell
  local home_dir
  local auth_file
  local key_count

  while IFS=: read -r user _ uid _ _ home_dir shell; do
    if [[ "${user}" == "root" ]]; then
      continue
    fi
    if [[ "${uid}" -lt 1000 ]]; then
      continue
    fi
    case "${shell}" in
      */nologin|*/false|"")
        continue
        ;;
    esac
    auth_file="${home_dir}/.ssh/authorized_keys"
    if [[ ! -f "${auth_file}" ]]; then
      continue
    fi
    key_count="$(
      awk '
        /^[[:space:]]*$/ { next }
        /^[[:space:]]*#/ { next }
        { c++ }
        END { print c + 0 }
      ' "${auth_file}"
    )"
    if [[ "${key_count}" -gt 0 ]]; then
      warn "SSH-capable user detected: ${user} (uid=${uid}, shell=${shell}, keys=${key_count})"
    fi
  done < /etc/passwd
}

configure_ssh() {
  local ssh_unit
  ssh_unit="$(pick_unit_name "ssh" "sshd")"

  write_file "/etc/ssh/sshd_config.d/99-hardening.conf" "0644" "root" "root" <<EOF
# Managed by public/sh/init.sh
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
PermitEmptyPasswords no
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
AllowAgentForwarding no
ClientAliveInterval 300
ClientAliveCountMax 2
EOF

  sshd -t
  if ! sshd -T | grep -Eq '^permitrootlogin[[:space:]]+(prohibit-password|without-password|yes)$'; then
    echo "Refusing to apply SSH config: root key-based login is not enabled." >&2
    return 1
  fi
  systemctl enable --now "${ssh_unit}"
  systemctl restart "${ssh_unit}"
}

configure_nginx() {
  write_file "/etc/nginx/conf.d/00-security-basics.conf" "0644" "root" "root" <<'EOF'
# Managed by public/sh/init.sh
server_tokens off;

add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header X-XSS-Protection "1; mode=block" always;
EOF

  nginx -t
  systemctl enable --now nginx
  systemctl reload nginx
}

configure_ufw() {
  local ssh_ports
  ssh_ports="$(sshd -T | awk '/^port / { print $2 }' | sort -u)"

  ufw default deny incoming
  ufw default allow outgoing

  # Allow SSH traffic
  if [[ -n "${ssh_ports}" ]]; then
    while IFS= read -r port; do
      [[ -z "${port}" ]] && continue
      ufw allow "${port}/tcp"
    done <<< "${ssh_ports}"
  else
    warn "Could not detect SSH port from sshd -T; defaulting to 22/tcp."
    ufw allow 22/tcp
  fi

  # Allow HTTP(S) traffic
  ufw allow 80/tcp
  ufw allow 443/tcp

  ufw --force enable
}

configure_fail2ban() {
  write_file "/etc/fail2ban/jail.d/sshd-nginx.local" "0644" "root" "root" <<'EOF'
# Managed by public/sh/init.sh
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
mode = aggressive
port = ssh
logpath = %(sshd_log)s

[nginx-http-auth]
enabled = true

[nginx-botsearch]
enabled = true
EOF

  fail2ban-client -t
  systemctl enable --now fail2ban
  systemctl restart fail2ban
}

configure_unattended_upgrades() {
  write_file "/etc/apt/apt.conf.d/20auto-upgrades" "0644" "root" "root" <<'EOF'
// Managed by public/sh/init.sh
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::AutocleanInterval "7";
APT::Periodic::Unattended-Upgrade "1";
EOF

  write_file "/etc/apt/apt.conf.d/52auto-security-upgrades" "0644" "root" "root" <<'EOF'
// Managed by public/sh/init.sh
Unattended-Upgrade::Origins-Pattern {
  "origin=Ubuntu,archive=${distro_codename}-security,label=Ubuntu";
  "origin=Ubuntu,archive=${distro_codename}-updates,label=Ubuntu";
};
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "false";
EOF

  systemctl enable --now unattended-upgrades
  systemctl restart unattended-upgrades
}

configure_shell_history() {
  write_file "/etc/profile.d/99-history-settings.sh" "0644" "root" "root" <<'EOF'
# Managed by public/sh/init.sh
export HISTSIZE=100000
export HISTFILESIZE=200000
export HISTCONTROL=ignoredups:erasedups
export HISTTIMEFORMAT="%F %T "
shopt -s histappend 2>/dev/null || true
case ";${PROMPT_COMMAND:-};" in
  *";history -a; history -n;"*) ;;
  *)
    PROMPT_COMMAND="history -a; history -n${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
    ;;
esac
export PROMPT_COMMAND
EOF
}

configure_etckeeper() {
  if [[ ! -f /etc/etckeeper/etckeeper.conf ]]; then
    warn "etckeeper config not found, skipping etckeeper setup"
    return 0
  fi

  if ! grep -q '^VCS="git"$' /etc/etckeeper/etckeeper.conf; then
    sed -i 's/^VCS=.*/VCS="git"/' /etc/etckeeper/etckeeper.conf
    log "Configured etckeeper to use git backend"
  fi

  if [[ ! -d /etc/.git ]]; then
    etckeeper init
    log "Initialized /etc git repository via etckeeper"
  fi

  if [[ -d /etc/.git ]] && [[ -n "$(git -C /etc status --porcelain)" ]]; then
    etckeeper commit "Initial /etc snapshot after bootstrap"
    log "Created initial etckeeper commit"
  else
    log "No /etc changes to commit with etckeeper"
  fi
}

configure_certbot_renewal() {
  write_file "/etc/letsencrypt/renewal-hooks/deploy/00-reload-nginx.sh" "0755" "root" "root" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
nginx -t
systemctl reload nginx
EOF

  if systemctl list-unit-files --type=timer --no-legend 2>/dev/null | awk '{print $1}' | grep -qx 'certbot.timer'; then
    systemctl enable --now certbot.timer
    if systemctl is-enabled --quiet certbot.timer; then
      log "certbot.timer is enabled for automatic certificate renewals"
    else
      warn "certbot.timer is present but not enabled"
    fi
  elif systemctl list-unit-files --type=timer --no-legend 2>/dev/null | awk '{print $1}' | grep -qx 'snap.certbot.renew.timer'; then
    systemctl enable --now snap.certbot.renew.timer
    if systemctl is-enabled --quiet snap.certbot.renew.timer; then
      log "snap.certbot.renew.timer is enabled for automatic certificate renewals"
    else
      warn "snap.certbot.renew.timer is present but not enabled"
    fi
  else
    warn "certbot.timer was not found; check certbot package installation"
  fi
}

configure_auditd_web_profile() {
  # Use distro-provided sample rules (low-noise oriented selection).
  install_any_audit_example_rule "baseline config" \
    "10-base-config.rules"

  install_any_audit_example_rule "loginuid tracking" \
    "11-loginuid.rules" \
    "10-loginuid.rules"

  install_any_audit_example_rule "safe failure mode" \
    "12-cont-fail.rules"

  # Ignore noisy chrony time-sync events.
  if ! install_audit_example_rule "22-ignore-chrony.rules"; then
    log "Optional audit rule 22-ignore-chrony.rules not found; skipping"
  fi

  # Focused examples for privilege escalation and module loading.
  install_any_audit_example_rule "privilege escalation monitoring" \
    "31-privileged.rules"

  install_any_audit_example_rule "kernel module monitoring" \
    "43-module-load.rules"

  # Useful low-noise extras for server operations.
  if ! install_audit_example_rule "32-power-abuse.rules"; then
    log "Optional audit rule 32-power-abuse.rules not found; skipping"
  fi
  if ! install_audit_example_rule "44-installers.rules"; then
    log "Optional audit rule 44-installers.rules not found; skipping"
  fi

  if [[ -f /etc/audit/auditd.conf ]]; then
    set_config_value "/etc/audit/auditd.conf" "max_log_file" "32"
    set_config_value "/etc/audit/auditd.conf" "num_logs" "10"
    set_config_value "/etc/audit/auditd.conf" "max_log_file_action" "ROTATE"
    set_config_value "/etc/audit/auditd.conf" "space_left" "25%"
    set_config_value "/etc/audit/auditd.conf" "space_left_action" "SYSLOG"
    set_config_value "/etc/audit/auditd.conf" "admin_space_left" "10%"
    set_config_value "/etc/audit/auditd.conf" "admin_space_left_action" "SUSPEND"
    set_config_value "/etc/audit/auditd.conf" "disk_full_action" "SUSPEND"
    set_config_value "/etc/audit/auditd.conf" "disk_error_action" "SUSPEND"
    set_config_value "/etc/audit/auditd.conf" "flush" "INCREMENTAL_ASYNC"
    set_config_value "/etc/audit/auditd.conf" "freq" "50"
    set_config_value "/etc/audit/auditd.conf" "name_format" "HOSTNAME"
    set_config_value "/etc/audit/auditd.conf" "write_logs" "yes"
    set_config_value "/etc/audit/auditd.conf" "priority_boost" "4"
    set_config_value "/etc/audit/auditd.conf" "overflow_action" "SYSLOG"
  else
    warn "auditd.conf is missing; skipping daemon hardening options"
  fi

  systemctl enable --now auditd
  if augenrules --load >/dev/null 2>&1; then
    log "auditd rules loaded"
  else
    warn "Failed to load auditd rules via augenrules"
  fi
  if auditctl -l 2>/dev/null | grep -q '^-e 2$'; then
    warn "auditd rules are immutable (-e 2); future automated rule updates require reboot"
  fi
  systemctl restart auditd
}

print_certbot_hint() {
  if has_deb_installed "python3-certbot-nginx"; then
    log "Run certbot when DNS is ready:"
    log "certbot --nginx --agree-tos -m admin@example.com --redirect -d example.com -d www.example.com"
  else
    warn "python3-certbot-nginx is not installed; use webroot mode for initial certificate issuance."
    log "certbot certonly --webroot -w /var/www/html --agree-tos -m admin@example.com -d example.com -d www.example.com"
  fi
}

health_summary() {
  local ssh_unit
  ssh_unit="$(pick_unit_name "ssh" "sshd")"

  log "Health summary:"

  if sshd -t >/dev/null 2>&1; then
    log " - sshd config: OK"
  else
    warn " - sshd config: FAIL"
  fi

  if sshd -T 2>/dev/null | grep -Eq '^permitrootlogin[[:space:]]+(prohibit-password|without-password|yes)$'; then
    log " - root SSH key login: OK"
  else
    warn " - root SSH key login: FAIL"
  fi

  if systemctl is-active --quiet "${ssh_unit}"; then
    log " - ${ssh_unit} service: active"
  else
    warn " - ${ssh_unit} service: not active"
  fi

  if systemctl is-active --quiet nginx; then
    log " - nginx service: active"
  else
    warn " - nginx service: not active"
  fi

  if systemctl is-active --quiet fail2ban; then
    log " - fail2ban service: active"
  else
    warn " - fail2ban service: not active"
  fi

  if ufw status 2>/dev/null | grep -Eq '^Status: active'; then
    log " - ufw: active"
  else
    warn " - ufw: not active"
  fi

  if (systemctl is-enabled --quiet certbot.timer 2>/dev/null && systemctl is-active --quiet certbot.timer 2>/dev/null) || \
     (systemctl is-enabled --quiet snap.certbot.renew.timer 2>/dev/null && systemctl is-active --quiet snap.certbot.renew.timer 2>/dev/null); then
    log " - certbot.timer: enabled and active"
  else
    warn " - certbot.timer: not enabled/active"
  fi

  if systemctl is-enabled --quiet unattended-upgrades; then
    log " - unattended-upgrades: enabled"
  else
    warn " - unattended-upgrades: not enabled"
  fi

  if systemctl is-active --quiet auditd; then
    log " - auditd service: active"
  else
    warn " - auditd service: not active"
  fi

  if auditctl -s 2>/dev/null | awk '/^enabled/ { exit ($2 >= 1 ? 0 : 1) } END { if (NR == 0) exit 1 }'; then
    log " - auditd ruleset: enabled"
  else
    warn " - auditd ruleset: disabled or unavailable"
  fi

  if auditctl -l 2>/dev/null | grep -Eq '(init_module|finit_module|delete_module|/sbin/modprobe|/usr/sbin/modprobe|kernel_modules)'; then
    log " - auditd kernel module monitoring: loaded"
  else
    warn " - auditd kernel module monitoring: missing"
  fi

  if auditctl -l 2>/dev/null | grep -Eq '(/usr/bin/sudo|/usr/bin/su|/usr/sbin/useradd|/usr/sbin/usermod|/usr/sbin/userdel|priv_esc|privileged)'; then
    log " - auditd privilege escalation monitoring: loaded"
  else
    warn " - auditd privilege escalation monitoring: missing"
  fi

}

main() {
  local root_key
  local pkg

  # Required packages for baseline server setup.
  local base_packages=(
    ca-certificates
    certbot
    curl
    auditd
    audispd-plugins
    fail2ban
    ufw
    etckeeper
    gnupg
    htop
    ncdu
    nginx
    openssh-server
    software-properties-common
    unattended-upgrades
    git
  )

  # Optional packages: useful for diagnostics and incident response.
  local optional_packages=(
    needrestart
    iproute2
    bmon
    iperf3
    dnsutils
    mtr-tiny
    netcat-openbsd
    tcpdump
    lsof
    sysstat
    jq
    rsync
    iotop
    atop
    python3-certbot-nginx
  )

  # 1) Update system package metadata and installed packages.
  log "Updating package index"
  apt-get update -y

  log "Upgrading packages"
  apt-get upgrade -y

  # 2) Install baseline and optional tooling.
  log "Installing base packages"
  apt-get install -y "${base_packages[@]}"

  log "Installing optional diagnostic/security packages"
  for pkg in "${optional_packages[@]}"; do
    if apt-cache show "${pkg}" >/dev/null 2>&1; then
      if apt-get install -y "${pkg}"; then
        log "Installed optional package: ${pkg}"
      else
        warn "Failed to install optional package: ${pkg}"
      fi
    else
      warn "Optional package not found in apt repo: ${pkg}"
    fi
  done

  # 3) Configure security controls and core services.
  root_key="$(fetch_primary_ssh_key)"
  configure_root_ssh_key "${root_key}"
  assert_root_ssh_access_preflight "${root_key}"
  warn_if_other_ssh_login_users_exist
  force_time_sync
  configure_ssh
  configure_nginx
  configure_certbot_renewal
  configure_ufw
  configure_fail2ban
  configure_unattended_upgrades
  configure_shell_history
  configure_auditd_web_profile
  configure_etckeeper

  # 4) Run post-configuration checks and print operator hints.
  health_summary

  log "Bootstrap complete."
  print_certbot_hint
}

main "$@"
