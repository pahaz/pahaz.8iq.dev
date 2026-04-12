#!/usr/bin/env bash
# Ubuntu 24.04 LTS server bootstrap script.
#
# One-liner (download + apply):
#   curl -fsSL "http://pahaz.8iq.dev/sh/init.sh" | sudo bash

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
if [[ "${VERSION_ID:-}" != "24.04" ]]; then
  echo "Expected Ubuntu 24.04 LTS, got ${PRETTY_NAME:-unknown}." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
SSH_KEY_URL="${SSH_KEY_URL:-https://github.com/pahaz.keys}"

log() {
  printf '[init] %s\n' "$*"
}

warn() {
  printf '[init][warn] %s\n' "$*" >&2
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

fetch_primary_ssh_key() {
  local key
  key="$(curl -fsSL "${SSH_KEY_URL}" | sed '/^\s*$/d' | head -n 1)"
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
  systemctl enable --now ssh
  systemctl restart ssh
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

  if [[ -n "${ssh_ports}" ]]; then
    while IFS= read -r port; do
      [[ -z "${port}" ]] && continue
      ufw allow "${port}/tcp"
    done <<< "${ssh_ports}"
  else
    ufw allow OpenSSH
  fi

  ufw allow 'Nginx Full'
  ufw --force enable
}

configure_fail2ban() {
  write_file "/etc/fail2ban/jail.d/sshd-nginx.local" "0644" "root" "root" <<'EOF'
# Managed by public/sh/init.sh
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5
banaction = iptables-multiport

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
  else
    warn "certbot.timer was not found; check certbot package installation"
  fi
}

main() {
  local root_key
  root_key="$(fetch_primary_ssh_key)"

  log "Updating package index"
  apt-get update -y

  log "Upgrading packages"
  apt-get upgrade -y

  log "Installing base packages"
  apt-get install -y \
    apt-transport-https \
    ca-certificates \
    certbot \
    curl \
    fail2ban \
    ufw \
    etckeeper \
    gnupg \
    htop \
    iotop \
    atop \
    ncdu \
    nginx \
    openssh-server \
    python3-certbot-nginx \
    software-properties-common \
    unattended-upgrades \
    needrestart \
    iproute2 \
    dnsutils \
    mtr-tiny \
    netcat-openbsd \
    tcpdump \
    lsof \
    sysstat \
    dstat \
    jq \
    rsync \
    git

  configure_root_ssh_key "${root_key}"
  assert_root_ssh_access_preflight "${root_key}"
  warn_if_other_ssh_login_users_exist
  configure_ssh
  configure_nginx
  configure_certbot_renewal
  configure_ufw
  configure_fail2ban
  configure_unattended_upgrades
  configure_shell_history
  configure_etckeeper

  log "Bootstrap complete."
  log "Run certbot when DNS is ready:"
  log "certbot --nginx --agree-tos -m admin@example.com --redirect -d example.com -d www.example.com"
}

main "$@"
