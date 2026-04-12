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

audit_rule_has_active_entries() {
  local rule_path="$1"
  [[ -f "${rule_path}" ]] || return 1
  awk '
    /^[[:space:]]*$/ { next }
    /^[[:space:]]*#/ { next }
    { found=1; exit 0 }
    END { exit(found ? 0 : 1) }
  ' "${rule_path}"
}

audit_ruleset_has_active_entries() {
  local rule_file
  for rule_file in /etc/audit/rules.d/*.rules; do
    [[ -f "${rule_file}" ]] || continue
    if audit_rule_has_active_entries "${rule_file}"; then
      return 0
    fi
  done
  return 1
}

generate_privileged_audit_rules() {
  local dst="/etc/audit/rules.d/31-privileged.rules"
  local tmp
  local scan_dir
  local binary_path
  local rule_count
  tmp="$(mktemp)"

  {
    echo "# Managed by public/sh/init.sh"
    echo "# Generated from local setuid binaries."
  } > "${tmp}"

  for scan_dir in /bin /sbin /usr/bin /usr/sbin /usr/local/bin /usr/local/sbin; do
    [[ -d "${scan_dir}" ]] || continue
    while IFS= read -r binary_path; do
      [[ -n "${binary_path}" ]] || continue
      printf '%s\n' "-a always,exit -F path=${binary_path} -F perm=x -F auid>=1000 -F auid!=unset -F key=privileged" >> "${tmp}"
    done < <(find "${scan_dir}" -xdev -type f -perm -04000 2>/dev/null | sort -u)
  done

  rule_count="$(
    awk '
      /^[[:space:]]*$/ { next }
      /^[[:space:]]*#/ { next }
      { c++ }
      END { print c + 0 }
    ' "${tmp}"
  )"

  if [[ "${rule_count}" -eq 0 ]]; then
    rm -f "${tmp}"
    warn "Could not generate privileged audit rules: no setuid binaries found"
    return 1
  fi

  if [[ ! -f "${dst}" ]] || ! cmp -s "${tmp}" "${dst}"; then
    install -D -m 0640 -o root -g root "${tmp}" "${dst}"
    log "Generated ${dst} with ${rule_count} privileged command rules"
  else
    log "Privileged audit rules already up to date: ${dst}"
  fi
  rm -f "${tmp}"
}

generate_software_installer_audit_rules() {
  local dst="/etc/audit/rules.d/50-software-installers.rules"
  local tmp
  local binary_path
  local rule_count
  local -a binaries=(
    /usr/bin/apt
    /usr/bin/apt-get
    /usr/bin/aptitude
    /usr/bin/dpkg
    /usr/bin/snap
    /usr/bin/pip
    /usr/bin/pip3
    /usr/bin/npm
    /usr/bin/yarn
    /usr/bin/gem
    /usr/bin/cpan
    /usr/bin/luarocks
    /usr/bin/dnf
    /usr/bin/yum
    /usr/bin/zypper
  )
  tmp="$(mktemp)"

  {
    echo "# Managed by public/sh/init.sh"
    echo "# Watch software installation tooling execution."
  } > "${tmp}"

  for binary_path in "${binaries[@]}"; do
    [[ -x "${binary_path}" ]] || continue
    printf '%s\n' "-w ${binary_path} -p x -k software-installer" >> "${tmp}"
  done

  rule_count="$(
    awk '
      /^[[:space:]]*$/ { next }
      /^[[:space:]]*#/ { next }
      { c++ }
      END { print c + 0 }
    ' "${tmp}"
  )"
  if [[ "${rule_count}" -eq 0 ]]; then
    rm -f "${tmp}"
    warn "No software installer binaries found for audit watches"
    return 0
  fi

  if [[ ! -f "${dst}" ]] || ! cmp -s "${tmp}" "${dst}"; then
    install -D -m 0640 -o root -g root "${tmp}" "${dst}"
    log "Generated ${dst} with ${rule_count} installer watch rules"
  else
    log "Software installer audit rules already up to date: ${dst}"
  fi
  rm -f "${tmp}"
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
  local ntp_issues=()

  # Prefer distro-default timesyncd, but fall back to chrony when present.
  if systemctl list-unit-files --type=service --no-legend 2>/dev/null | awk '{print $1}' | grep -qx 'systemd-timesyncd.service'; then
    ntp_unit="systemd-timesyncd"
  elif systemctl list-unit-files --type=service --no-legend 2>/dev/null | awk '{print $1}' | grep -qx 'chrony.service'; then
    ntp_unit="chrony"
  fi

  if ! timedatectl set-ntp true 2>/dev/null; then
    ntp_issues+=("timedatectl set-ntp failed")
  fi

  if [[ -n "${ntp_unit}" ]]; then
    if ! systemctl enable --now "${ntp_unit}" 2>/dev/null; then
      ntp_issues+=("failed to enable/start ${ntp_unit}.service")
    fi
    if ! systemctl restart "${ntp_unit}" 2>/dev/null; then
      ntp_issues+=("failed to restart ${ntp_unit}.service")
    fi
  else
    ntp_issues+=("no known NTP service unit found (systemd-timesyncd/chrony)")
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
    if [[ "${#ntp_issues[@]}" -gt 0 ]]; then
      warn "Time sync was enabled but not yet synchronized (${ntp_issues[*]}); check network/NTP reachability"
    else
      warn "Time sync was enabled but not yet synchronized; check network/NTP reachability"
    fi
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
  local ssh_enable_unit
  local enable_err
  local sshd_effective
  ssh_unit="$(pick_unit_name "ssh" "sshd")"
  ssh_enable_unit="$(systemctl show -p Id --value "${ssh_unit}.service" 2>/dev/null || true)"
  ssh_enable_unit="${ssh_enable_unit%.service}"
  if [[ -z "${ssh_enable_unit}" ]]; then
    ssh_enable_unit="${ssh_unit}"
  fi

  # OpenSSH uses the first value it reads for many directives.
  # Keep hardening in an early include file so cloud-init defaults do not override it.
  write_file "/etc/ssh/sshd_config.d/00-hardening.conf" "0644" "root" "root" <<EOF
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

  # Cleanup old filename used by earlier script versions.
  if [[ -f "/etc/ssh/sshd_config.d/99-hardening.conf" ]]; then
    rm -f "/etc/ssh/sshd_config.d/99-hardening.conf"
    log "Removed legacy /etc/ssh/sshd_config.d/99-hardening.conf"
  fi

  sshd -t
  # Evaluate effective root login policy with and without connection context
  # to avoid false negatives when Match blocks are present.
  if ! sshd_effective="$(sshd -T -C user=root -C host=localhost -C addr=127.0.0.1 2>/dev/null)"; then
    sshd_effective="$(sshd -T 2>/dev/null || true)"
  fi
  if ! awk '
    /^permitrootlogin[[:space:]]+(prohibit-password|without-password|yes)$/ { found=1 }
    END { exit(found ? 0 : 1) }
  ' <<< "${sshd_effective}"; then
    echo "Refusing to apply SSH config: effective root key-based login is not enabled." >&2
    return 1
  fi
  if ! enable_err="$(systemctl enable --now "${ssh_enable_unit}" 2>&1)"; then
    if [[ "${enable_err}" == *"Refusing to operate on alias name or linked unit file"* ]]; then
      warn "Cannot enable ${ssh_enable_unit}.service directly; starting without enable."
      systemctl start "${ssh_enable_unit}"
    else
      printf '%s\n' "${enable_err}" >&2
      return 1
    fi
  fi
  systemctl restart "${ssh_enable_unit}"
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
  local legacy_rule
  local -a legacy_rules=(
    /etc/audit/rules.d/10-base-config.rules
    /etc/audit/rules.d/10-loginuid.rules
    /etc/audit/rules.d/11-loginuid.rules
    /etc/audit/rules.d/12-cont-fail.rules
    /etc/audit/rules.d/22-ignore-chrony.rules
    /etc/audit/rules.d/31-privileged.rules
    /etc/audit/rules.d/32-power-abuse.rules
    /etc/audit/rules.d/43-module-load.rules
    /etc/audit/rules.d/44-installers.rules
  )

  for legacy_rule in "${legacy_rules[@]}"; do
    if [[ -f "${legacy_rule}" ]]; then
      rm -f "${legacy_rule}"
      log "Removed legacy audit rule ${legacy_rule}"
    fi
  done

  write_file "/etc/audit/rules.d/10-base.rules" "0640" "root" "root" <<'EOF'
# Managed by public/sh/init.sh
-D
-b 8192
-f 1
EOF

  write_file "/etc/audit/rules.d/20-identity.rules" "0640" "root" "root" <<'EOF'
# Managed by public/sh/init.sh
-w /etc/passwd -p wa -k identity
-w /etc/group -p wa -k identity
-w /etc/shadow -p wa -k identity
-w /etc/gshadow -p wa -k identity
-w /usr/sbin/useradd -p x -k identity
-w /usr/sbin/usermod -p x -k identity
-w /usr/sbin/userdel -p x -k identity
-w /usr/sbin/groupadd -p x -k identity
-w /usr/sbin/groupmod -p x -k identity
-w /usr/sbin/groupdel -p x -k identity
EOF

  write_file "/etc/audit/rules.d/40-kernel-modules.rules" "0640" "root" "root" <<'EOF'
# Managed by public/sh/init.sh
-a always,exit -F arch=b32 -S init_module,finit_module -F key=kernel_modules
-a always,exit -F arch=b64 -S init_module,finit_module -F key=kernel_modules
-a always,exit -F arch=b32 -S delete_module -F key=kernel_modules
-a always,exit -F arch=b64 -S delete_module -F key=kernel_modules
-w /usr/sbin/insmod -p x -k kernel_modules
-w /usr/sbin/rmmod -p x -k kernel_modules
-w /usr/sbin/modprobe -p x -k kernel_modules
EOF

  write_file "/etc/audit/rules.d/45-power-abuse.rules" "0640" "root" "root" <<'EOF'
# Managed by public/sh/init.sh
-a always,exit -F dir=/home -F uid=0 -F auid>=1000 -F auid!=-1 -C auid!=obj_uid -F key=power-abuse
EOF

  generate_privileged_audit_rules
  generate_software_installer_audit_rules

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
  local audit_enabled_state
  local augenrules_output
  audit_enabled_state="$(
    auditctl -s 2>/dev/null | awk '$1 == "enabled" { print $2; exit }'
  )"
  if [[ "${audit_enabled_state}" == "2" ]]; then
    warn "auditd rules are immutable (-e 2); skipping augenrules --load until reboot"
  elif augenrules_output="$(augenrules --load 2>&1)"; then
    log "auditd rules loaded"
  else
    if [[ "${augenrules_output}" == *"No rules"* ]] && audit_ruleset_has_active_entries; then
      log "augenrules reported 'No rules', but active files exist in /etc/audit/rules.d; continuing"
    else
      warn "Failed to load auditd rules via augenrules"
      if [[ -n "${augenrules_output}" ]]; then
        warn "augenrules output: ${augenrules_output}"
      fi
    fi
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
  local sshd_effective
  ssh_unit="$(pick_unit_name "ssh" "sshd")"

  log "Health summary:"

  if sshd -t >/dev/null 2>&1; then
    log " - sshd config: OK"
  else
    warn " - sshd config: FAIL"
  fi

  sshd_effective="$(sshd -T 2>/dev/null || true)"
  if awk '
    /^permitrootlogin[[:space:]]+(prohibit-password|without-password|yes)$/ { found=1 }
    END { exit(found ? 0 : 1) }
  ' <<< "${sshd_effective}"; then
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
