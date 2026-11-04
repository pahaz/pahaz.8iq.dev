#!/usr/bin/env bash
# Server bootstrap script for Debian-based systems:
# Ubuntu 22.04+, Debian 11+ and Raspberry Pi OS.
#
# One-liner (download + apply):
#   curl -fsSL "https://pahaz.8iq.dev/sh/init.sh" | sudo bash
# Debug mode:
#   curl -fsSL "https://pahaz.8iq.dev/sh/init.sh" | sudo bash -s -- --debug
#   sudo INIT_DEBUG=1 bash ./init.sh

set -Eeuo pipefail

# "su" without "-" on Debian leaves the sbin directories out of PATH.
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"

DEBUG_MODE="${INIT_DEBUG:-0}"
SHOW_HELP=0

usage() {
  cat <<'EOF'
Usage: init.sh [OPTIONS]

Options:
  --debug, -x   Enable shell command tracing (set -x)
  --help, -h    Show this help message and exit

Environment:
  INIT_DEBUG=1          Enable debug mode (same as --debug)
  SSH_KEY_URL=URL       Where to get the SSH key; the first key is used for both
                        root and the admin user
                        (default: https://github.com/pahaz.keys)
  ADMIN_USER=NAME       Admin user with passwordless sudo (default: pahaz)
  AUDIT_IMMUTABLE=0     Allow changing audit rules without a reboot
                        (default: 1, rules are locked until the next reboot)
  AUDIT_LOG_TOTAL_MB=N  Size limit for audit logs
                        (default: 5% of the disk, from 50 to 500 MB)
EOF
}

parse_args() {
  local arg
  local -a unknown_args=()

  for arg in "$@"; do
    case "${arg}" in
      --debug|-x)
        DEBUG_MODE=1
        ;;
      --help|-h)
        SHOW_HELP=1
        ;;
      *)
        unknown_args+=("${arg}")
        ;;
    esac
  done

  if [[ "${#unknown_args[@]}" -gt 0 ]]; then
    printf 'Unknown argument(s): %s\n' "${unknown_args[*]}" >&2
    usage >&2
    exit 1
  fi
}

normalize_debug_mode() {
  local normalized
  normalized="$(printf '%s' "${DEBUG_MODE}" | tr '[:upper:]' '[:lower:]')"
  case "${normalized}" in
    1|true|yes|on)
      DEBUG_MODE=1
      ;;
    0|false|no|off|'')
      DEBUG_MODE=0
      ;;
    *)
      printf 'Invalid INIT_DEBUG value: %s\n' "${DEBUG_MODE}" >&2
      printf 'Use one of: 1,0,true,false,yes,no,on,off\n' >&2
      exit 1
      ;;
  esac
}

parse_args "$@"
normalize_debug_mode
if [[ "${SHOW_HELP}" -eq 1 ]]; then
  usage
  exit 0
fi

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
OS_ID="${ID:-}"
OS_VERSION="${VERSION_ID:-}"
OS_MAJOR="${OS_VERSION%%.*}"

case "${OS_ID}" in
  ubuntu)
    OS_MIN_MAJOR=22
    ;;
  debian|raspbian)
    OS_MIN_MAJOR=11
    ;;
  *)
    echo "This script supports Ubuntu, Debian and Raspberry Pi OS only (detected ${PRETTY_NAME:-unknown})." >&2
    exit 1
    ;;
esac
if [[ ! "${OS_MAJOR}" =~ ^[0-9]+$ ]]; then
  echo "Unsupported version format: ${OS_VERSION:-none} (${PRETTY_NAME:-unknown})" >&2
  exit 1
fi
if (( OS_MAJOR < OS_MIN_MAJOR )); then
  echo "${PRETTY_NAME:-${OS_ID} ${OS_VERSION}} is too old. Need ${OS_ID} ${OS_MIN_MAJOR}+." >&2
  exit 1
fi
if [[ "${OS_ID}" == "ubuntu" && "${OS_VERSION#*.}" != "04" ]]; then
  echo "Warning: ${PRETTY_NAME:-unknown} is not an LTS .04 release; continuing." >&2
fi
if [[ "${OS_ID} ${OS_VERSION}" != "ubuntu 24.04" ]]; then
  echo "Warning: script is tested primarily on Ubuntu 24.04 LTS (detected ${PRETTY_NAME:-unknown})." >&2
fi

export DEBIAN_FRONTEND=noninteractive
SSH_KEY_URL="${SSH_KEY_URL:-https://github.com/pahaz.keys}"
ADMIN_USER="${ADMIN_USER:-pahaz}"
AUDIT_IMMUTABLE="${AUDIT_IMMUTABLE:-1}"
AUDIT_LOG_TOTAL_MB="${AUDIT_LOG_TOTAL_MB:-}"

if [[ ! "${ADMIN_USER}" =~ ^[a-z_][a-z0-9_-]*$ ]]; then
  echo "Invalid ADMIN_USER: ${ADMIN_USER}" >&2
  exit 1
fi
if [[ "${AUDIT_IMMUTABLE}" != "0" && "${AUDIT_IMMUTABLE}" != "1" ]]; then
  echo "Invalid AUDIT_IMMUTABLE: ${AUDIT_IMMUTABLE} (use 0 or 1)" >&2
  exit 1
fi
if [[ -n "${AUDIT_LOG_TOTAL_MB}" && ! "${AUDIT_LOG_TOTAL_MB}" =~ ^[1-9][0-9]*$ ]]; then
  echo "Invalid AUDIT_LOG_TOTAL_MB: ${AUDIT_LOG_TOTAL_MB}" >&2
  exit 1
fi

AUDIT_RULES_DIR="/etc/audit/rules.d"
AUDIT_REFRESH_SCRIPT="/usr/local/sbin/init-audit-refresh"
AUDIT_LOG_FILES=10

FAILED_STEPS=()
HEALTH_PROBLEMS=0

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

# Shows where the script failed: "set -e" alone exits without saying so.
on_error() {
  # A function that returns an error has already said why.
  if [[ "$3" != return* ]]; then
    printf '\n[init][error] line %s, exit code %s: %s\n' "$2" "$1" "$3" >&2
  fi
}
# shellcheck disable=SC2016  # Expanded when the trap fires.
ERR_TRAP='on_error $? $LINENO "$BASH_COMMAND"'
# shellcheck disable=SC2064
trap "${ERR_TRAP}" ERR

# Runs one setup step so that its failure does not cancel the steps after it:
# a broken nginx config must not leave the server without a firewall.
# Must not be called from "if" or "||": bash would ignore "set -e" inside.
run_step() {
  local name="$1"
  shift
  local status

  log "Step: ${name}"
  trap - ERR
  set +e
  (
    set -e
    # shellcheck disable=SC2064
    trap "${ERR_TRAP}" ERR
    "$@"
  )
  status=$?
  set -e
  # shellcheck disable=SC2064
  trap "${ERR_TRAP}" ERR

  if [[ "${status}" -ne 0 ]]; then
    FAILED_STEPS+=("${name}")
    warn "Step failed: ${name} (exit code ${status}); continuing with the next steps"
  fi
}

enable_debug_mode() {
  if [[ "${DEBUG_MODE}" -ne 1 ]]; then
    return 0
  fi

  # Tracing can include command arguments and variable values.
  export PS4='+ [${BASH_SOURCE##*/}:${LINENO}:${FUNCNAME[0]:-main}] '
  set -x
  log "Debug mode enabled (command tracing)"
}

secure_curl() {
  curl --proto '=https' -fsSL --connect-timeout 15 --max-time 60 --retry 3 "$@"
}

# --force-conf*: keep local config files on upgrades. dpkg asks about them even
# with DEBIAN_FRONTEND=noninteractive, and "curl | bash" has nobody to answer.
apt_get() {
  apt-get -y \
    -o Acquire::Retries=3 \
    -o DPkg::Lock::Timeout=300 \
    -o Dpkg::Options::=--force-confdef \
    -o Dpkg::Options::=--force-confold \
    "$@"
}

# "apt-get update" has no lock timeout, and a freshly booted machine often runs
# its own update at the same time.
apt_update() {
  local attempt
  for attempt in 1 2 3 4 5 6; do
    if apt_get update; then
      return 0
    fi
    warn "apt-get update failed (attempt ${attempt}/6); retrying in 20 seconds"
    sleep 20
  done
  return 1
}

has_deb_installed() {
  local package="$1"
  dpkg-query -W -f='${db:Status-Abbrev}' "${package}" 2>/dev/null | grep -q '^ii'
}

# Avoid "producer | grep -q" in this script: grep exits at the first match, the
# producer dies from the closed pipe, and pipefail turns the match into a failure.
unit_file_exists() {
  local unit="$1"
  [[ -n "$(systemctl list-unit-files --no-legend "${unit}" 2>/dev/null || true)" ]]
}

pick_unit_name() {
  local preferred="$1"
  local fallback="$2"

  if unit_file_exists "${preferred}.service"; then
    printf '%s\n' "${preferred}"
    return 0
  fi
  if unit_file_exists "${fallback}.service"; then
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

ensure_curl() {
  if command -v curl >/dev/null 2>&1; then
    return 0
  fi
  log "Installing curl to fetch the SSH key"
  apt_update
  apt_get install ca-certificates curl
}

# Takes the first key from SSH_KEY_URL.
fetch_primary_ssh_key() {
  local keys
  local key
  if [[ ! "${SSH_KEY_URL}" =~ ^https:// ]]; then
    echo "SSH_KEY_URL must use https:// (got: ${SSH_KEY_URL})" >&2
    return 1
  fi
  # Read everything first: "curl | head -n 1" can fail under pipefail when head
  # closes the pipe early.
  if ! keys="$(secure_curl "${SSH_KEY_URL}")"; then
    echo "Failed to fetch SSH key from ${SSH_KEY_URL}" >&2
    return 1
  fi
  key="$(awk 'NF && !/^[[:space:]]*#/ { print; exit }' <<< "${keys}")"
  if [[ -z "${key}" ]]; then
    echo "No SSH key found at ${SSH_KEY_URL}" >&2
    return 1
  fi
  if [[ ! "${key}" =~ ^(ssh-(rsa|ed25519)|ecdsa-sha2-nistp(256|384|521)|sk-(ssh-ed25519|ecdsa-sha2-nistp256)@openssh\.com)[[:space:]]+[A-Za-z0-9+/=]+ ]]; then
    echo "Fetched key has unexpected format: ${key}" >&2
    return 1
  fi
  printf '%s\n' "${key}"
}

# Looks for the key as separate fields, ignoring its comment and options. A key
# glued to the previous line does not count, because sshd would not accept it.
authorized_keys_has_key() {
  local auth_file="$1"
  local key="$2"
  local key_type
  local key_body
  read -r key_type key_body _ <<< "${key}"

  awk -v key_type="${key_type}" -v key_body="${key_body}" '
    {
      for (i = 1; i < NF; i++) {
        if ($i == key_type && $(i + 1) == key_body) { found = 1 }
      }
    }
    END { exit(found ? 0 : 1) }
  ' "${auth_file}"
}

ensure_key_in_authorized_keys() {
  local username="$1"
  local key="$2"
  local home_dir
  local group
  local auth_file

  home_dir="$(getent passwd "${username}" | cut -d: -f6)"
  if [[ -z "${home_dir}" ]]; then
    echo "Cannot detect home directory for ${username}" >&2
    return 1
  fi
  group="$(id -gn "${username}")"

  install -d -m 0700 -o "${username}" -g "${group}" "${home_dir}/.ssh"
  auth_file="${home_dir}/.ssh/authorized_keys"
  touch "${auth_file}"
  chown "${username}:${group}" "${auth_file}"
  chmod 0600 "${auth_file}"

  if authorized_keys_has_key "${auth_file}" "${key}"; then
    log "Key already present for ${username}"
    return 0
  fi

  # Without this the new key is glued to the last line, breaking both keys.
  if [[ -s "${auth_file}" && -n "$(tail -c 1 "${auth_file}")" ]]; then
    printf '\n' >> "${auth_file}"
  fi
  printf '%s\n' "${key}" >> "${auth_file}"
  log "Added key for ${username}"
}

warn_if_other_keys_present() {
  local username="$1"
  local expected_key="$2"
  local home_dir
  local auth_file
  local key_type
  local key_body
  read -r key_type key_body _ <<< "${expected_key}"

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
    awk -v key="${key_type} ${key_body}" '
      /^[[:space:]]*$/ { next }
      /^[[:space:]]*#/ { next }
      index($0, key) == 0 { c++ }
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

configure_admin_user() {
  local key="$1"
  local shell

  if ! id "${ADMIN_USER}" >/dev/null 2>&1; then
    useradd --create-home --shell /bin/bash --user-group "${ADMIN_USER}"
    # No password can match "*", and sshd does not treat the account as locked,
    # which it can do with useradd's default "!".
    usermod --password '*' "${ADMIN_USER}"
    log "Created user ${ADMIN_USER}"
  fi

  shell="$(getent passwd "${ADMIN_USER}" | cut -d: -f7)"
  case "${shell}" in
    */nologin|*/false|"")
      usermod --shell /bin/bash "${ADMIN_USER}"
      log "Changed login shell of ${ADMIN_USER} to /bin/bash"
      ;;
  esac

  ensure_key_in_authorized_keys "${ADMIN_USER}" "${key}"
  warn_if_other_keys_present "${ADMIN_USER}" "${key}"
  configure_admin_sudo
}

configure_admin_sudo() {
  local tmp
  tmp="$(mktemp)"
  printf '# Managed by public/sh/init.sh\n%s ALL=(ALL:ALL) NOPASSWD:ALL\n' "${ADMIN_USER}" > "${tmp}"
  # A broken file in sudoers.d stops sudo for everyone, so check it first.
  visudo -cqf "${tmp}"
  write_file "/etc/sudoers.d/90-${ADMIN_USER}" "0440" "root" "root" < "${tmp}"
  rm -f "${tmp}"
  usermod --append --groups sudo "${ADMIN_USER}"
}

force_time_sync() {
  local synced="no"
  local attempt=0
  local max_attempts=20
  local ntp_unit=""
  local ntp_issues=()

  # Prefer distro-default timesyncd, but fall back to chrony when present.
  if unit_file_exists 'systemd-timesyncd.service'; then
    ntp_unit="systemd-timesyncd"
  elif unit_file_exists 'chrony.service'; then
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

# Checks what sshd itself will look at when this key logs in. Runs before
# password login is turned off, while it can still stop the script.
assert_ssh_access_preflight() {
  local key="$1"
  local user
  local home_dir
  local auth_file
  local path
  local problems=0

  if ! ssh-keygen -lf - <<< "${key}" >/dev/null 2>&1; then
    echo "ssh-keygen cannot read the SSH key: ${key}" >&2
    return 1
  fi

  for user in root "${ADMIN_USER}"; do
    home_dir="$(getent passwd "${user}" | cut -d: -f6)"
    auth_file="${home_dir}/.ssh/authorized_keys"
    if [[ ! -f "${auth_file}" ]] || ! authorized_keys_has_key "${auth_file}" "${key}"; then
      echo "SSH key for ${user} is missing or damaged in ${auth_file}" >&2
      problems=$((problems + 1))
      continue
    fi
    # sshd ignores keys when these paths are writable by others (StrictModes).
    for path in "${home_dir}" "${home_dir}/.ssh" "${auth_file}"; do
      if [[ "$(stat -c '%U' "${path}")" != "${user}" && "$(stat -c '%U' "${path}")" != "root" ]]; then
        echo "Wrong owner of ${path}: sshd will reject the key of ${user}" >&2
        problems=$((problems + 1))
      fi
      if [[ -n "$(find "${path}" -maxdepth 0 -perm /022)" ]]; then
        echo "${path} is writable by others: sshd will reject the key of ${user}" >&2
        problems=$((problems + 1))
      fi
    done
  done

  [[ "${problems}" -eq 0 ]]
}

warn_about_ssh_login_users() {
  local user
  local uid
  local shell
  local home_dir
  local auth_file
  local key_count

  while IFS=: read -r user _ uid _ _ home_dir shell; do
    if [[ "${user}" == "root" || "${user}" == "${ADMIN_USER}" ]]; then
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
    key_count=0
    if [[ -f "${auth_file}" ]]; then
      key_count="$(
        awk '
          /^[[:space:]]*$/ { next }
          /^[[:space:]]*#/ { next }
          { c++ }
          END { print c + 0 }
        ' "${auth_file}"
      )"
    fi
    if [[ "${key_count}" -gt 0 ]]; then
      warn "SSH-capable user detected: ${user} (uid=${uid}, shell=${shell}, keys=${key_count})"
    else
      warn "User ${user} (uid=${uid}, shell=${shell}) has no SSH keys and will not be able to log in over SSH with a password"
    fi
  done < /etc/passwd
}

# With socket activation (Ubuntu 22.10+) ssh.service may not have run yet, and
# only it creates this directory. sshd -t and -T refuse to work without it.
ensure_sshd_runtime_dir() {
  install -d -m 0755 /run/sshd
}

sshd_config_for_user() {
  sshd -T -C "user=$1,host=localhost,addr=127.0.0.1" 2>/dev/null
}

# True when sshd, as configured on disk, lets this user log in with a key.
sshd_allows_key_login() {
  local user="$1"
  local config
  local allowed_users

  if ! config="$(sshd_config_for_user "${user}")"; then
    echo "sshd -T failed for user ${user}" >&2
    return 1
  fi
  if ! grep -qx 'pubkeyauthentication yes' <<< "${config}"; then
    echo "sshd does not allow public key login for ${user}" >&2
    return 1
  fi
  if ! grep -qE '^authorizedkeysfile( .*)? \.ssh/authorized_keys( |$)' <<< "${config}"; then
    echo "sshd does not read .ssh/authorized_keys for ${user}" >&2
    return 1
  fi
  if [[ "${user}" == "root" ]] && ! grep -qE '^permitrootlogin (prohibit-password|without-password|yes)$' <<< "${config}"; then
    echo "sshd does not allow root key login" >&2
    return 1
  fi
  allowed_users="$(awk '$1 == "allowusers" { print $2 }' <<< "${config}")"
  if [[ -n "${allowed_users}" ]] && ! grep -qx "${user}" <<< "${allowed_users}"; then
    echo "sshd AllowUsers does not include ${user}" >&2
    return 1
  fi
  if grep -qx "denyusers ${user}" <<< "${config}"; then
    echo "sshd DenyUsers includes ${user}" >&2
    return 1
  fi
}

configure_ssh() {
  local ssh_unit
  local ssh_enable_unit
  local hardening="/etc/ssh/sshd_config.d/00-hardening.conf"
  local main_config="/etc/ssh/sshd_config"
  local main_config_backup
  local allow_users=""
  local user
  local config_ok=1

  ssh_unit="$(pick_unit_name "ssh" "sshd")"
  ssh_enable_unit="$(systemctl show -p Id --value "${ssh_unit}.service" 2>/dev/null || true)"
  ssh_enable_unit="${ssh_enable_unit%.service}"
  if [[ -z "${ssh_enable_unit}" ]]; then
    ssh_enable_unit="${ssh_unit}"
  fi

  ensure_sshd_runtime_dir
  main_config_backup="$(mktemp)"
  cp -p "${main_config}" "${main_config_backup}"

  # OpenSSH uses the first value it reads for many directives. A customized
  # sshd_config may have lost this line, and then the file below does nothing.
  if ! grep -Eq '^[[:space:]]*Include[[:space:]]+/etc/ssh/sshd_config\.d/' "${main_config}"; then
    sed -i '1i Include /etc/ssh/sshd_config.d/*.conf' "${main_config}"
    log "Added the sshd_config.d include to ${main_config}"
  fi

  # AllowUsers lines add up. If logins are already limited to a list, root and the
  # admin must join it. If not, adding the line would lock out everyone else.
  if grep -q '^allowusers ' <<< "$(sshd -T 2>/dev/null || true)"; then
    allow_users="AllowUsers root ${ADMIN_USER}"
  fi

  # Keep hardening in an early include file so cloud-init defaults do not override it.
  write_file "${hardening}" "0644" "root" "root" <<EOF
# Managed by public/sh/init.sh
${allow_users}
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
PermitEmptyPasswords no
MaxAuthTries 5
LoginGraceTime 30
X11Forwarding no
AllowAgentForwarding no
ClientAliveInterval 300
ClientAliveCountMax 2
EOF

  if ! sshd -t; then
    config_ok=0
  fi
  for user in root "${ADMIN_USER}"; do
    if ! sshd_allows_key_login "${user}"; then
      config_ok=0
    fi
  done
  if [[ "${config_ok}" -ne 1 ]]; then
    # Files left in place would still apply at the next sshd start or reboot.
    rm -f "${hardening}"
    cp -p "${main_config_backup}" "${main_config}"
    rm -f "${main_config_backup}"
    echo "Refusing to apply SSH config: it would break key-based login. Changes reverted." >&2
    return 1
  fi
  rm -f "${main_config_backup}"

  # A socket-activated sshd starts through ssh.socket; ssh.service stays as it is.
  if ! systemctl is-enabled --quiet ssh.socket 2>/dev/null; then
    if ! systemctl enable "${ssh_enable_unit}"; then
      warn "Cannot enable ${ssh_enable_unit}.service; check that sshd starts after a reboot."
    fi
  fi
  systemctl restart "${ssh_enable_unit}"
}

# Asks the running sshd, not the config on disk, which login methods it offers.
# Uses the "none" method from this host: it sends no credentials, and fail2ban
# ignores the host's own addresses.
sshd_live_auth_methods() {
  local port="$1"
  LC_ALL=C ssh -p "${port}" \
    -o BatchMode=yes \
    -o ConnectTimeout=5 \
    -o PreferredAuthentications=none \
    -o PubkeyAuthentication=no \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    root@127.0.0.1 true 2>&1 </dev/null \
    | sed -n 's/.*Permission denied (\(.*\))\.[[:space:]]*$/\1/p' || true
}

# Prints the PIDs of sshd listeners that systemd does not track. They survive
# "systemctl restart ssh" and keep running with their old settings.
sshd_stale_listeners() {
  local ssh_unit="$1"
  local main_pid
  main_pid="$(systemctl show -p MainPID --value "${ssh_unit}.service" 2>/dev/null || true)"
  ss -H -ltnp 2>/dev/null \
    | grep -oE '"sshd",pid=[0-9]+' \
    | grep -oE '[0-9]+$' \
    | sort -u \
    | grep -vx "${main_pid:-0}" || true
}

# Ports to keep open. What really listens counts as well as the config, because
# blocking it would cut SSH access.
get_ssh_ports() {
  local ports
  ensure_sshd_runtime_dir
  ports="$(sshd -T 2>/dev/null | awk '$1 == "port" { print $2 }' || true)"
  ports+=$'\n'"$(ss -H -ltnp 2>/dev/null | awk '/"sshd"/ { n = split($4, parts, ":"); print parts[n] }' || true)"
  if systemctl is-active --quiet ssh.socket 2>/dev/null; then
    ports+=$'\n'"$(systemctl show -p Listen --value ssh.socket 2>/dev/null | grep -oE ':[0-9]+ ' | tr -d ': ' || true)"
  fi
  ports="$(sed '/^[[:space:]]*$/d' <<< "${ports}" | sort -un)"
  printf '%s\n' "${ports:-22}"
}

configure_nginx() {
  write_file "/etc/nginx/conf.d/00-security-basics.conf" "0644" "root" "root" <<'EOF'
# Managed by public/sh/init.sh
server_tokens off;

add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
EOF

  nginx -t
  systemctl enable --now nginx
  systemctl reload nginx
}

configure_ufw() {
  local port

  # Allow SSH traffic before anything can block it.
  while IFS= read -r port; do
    ufw allow "${port}/tcp"
  done < <(get_ssh_ports)

  # Allow HTTP(S) traffic
  ufw allow 80/tcp
  ufw allow 443/tcp

  ufw default deny incoming
  ufw default allow outgoing

  ufw --force enable
}

configure_fail2ban() {
  local ssh_ports
  local log_file
  ssh_ports="$(get_ssh_ports | paste -sd, -)"

  # Jails with backend = auto do not start until their log file exists.
  for log_file in /var/log/nginx/error.log /var/log/nginx/access.log; do
    if [[ -d /var/log/nginx && ! -e "${log_file}" ]]; then
      install -m 0640 -o www-data -g adm /dev/null "${log_file}"
    fi
  done

  # The default keeps ban history for one day, too short for the longer bans.
  write_file "/etc/fail2ban/fail2ban.d/90-init-sh.local" "0644" "root" "root" <<'EOF'
# Managed by public/sh/init.sh
[DEFAULT]
dbpurgeage = 30d
EOF

  write_file "/etc/fail2ban/jail.d/sshd-nginx.local" "0644" "root" "root" <<EOF
# Managed by public/sh/init.sh
[DEFAULT]
# Each repeat ban is longer: 1 min, 5 min, 25 min, about 2 h, 10 h, 2 days, 11 days.
bantime = 1m
bantime.increment = true
bantime.multipliers = 1 5 25 125 625 3125 15625
findtime = 10m
maxretry = 5

[sshd]
enabled = true
mode = aggressive
port = ${ssh_ports}
# Debian-based releases differ in where sshd logs and which file names it uses.
# The journal works on all of them; sshd-session appeared in OpenSSH 9.8.
backend = systemd
journalmatch = _SYSTEMD_UNIT=ssh.service + _SYSTEMD_UNIT=sshd.service + _COMM=sshd + _COMM=sshd-session

# nginx logs to files. The systemd backend some releases set as the default
# looks in the journal and would never see these failures.
[nginx-http-auth]
enabled = true
backend = auto

[nginx-botsearch]
enabled = true
backend = auto
EOF

  fail2ban-client -t
  systemctl enable --now fail2ban
  systemctl restart fail2ban
}

configure_unattended_upgrades() {
  local -a origins=()

  # shellcheck disable=SC2016  # ${distro_codename} is expanded by unattended-upgrades.
  case "${OS_ID}" in
    ubuntu)
      origins+=(
        'origin=Ubuntu,archive=${distro_codename}-security,label=Ubuntu'
        'origin=Ubuntu,archive=${distro_codename}-updates,label=Ubuntu'
      )
      ;;
    debian)
      origins+=(
        'origin=Debian,codename=${distro_codename},label=Debian-Security'
        'origin=Debian,codename=${distro_codename}-security,label=Debian-Security'
        'origin=Debian,codename=${distro_codename},label=Debian'
        'origin=Debian,codename=${distro_codename}-updates,label=Debian'
      )
      ;;
    raspbian)
      origins+=('origin=Raspbian,codename=${distro_codename},label=Raspbian')
      ;;
  esac
  # shellcheck disable=SC2016
  if [[ -e /etc/rpi-issue ]]; then
    origins+=('origin=Raspberry Pi Foundation,codename=${distro_codename},label=Raspberry Pi Foundation')
  fi

  write_file "/etc/apt/apt.conf.d/20auto-upgrades" "0644" "root" "root" <<'EOF'
// Managed by public/sh/init.sh
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::AutocleanInterval "7";
APT::Periodic::Unattended-Upgrade "1";
EOF

  {
    echo '// Managed by public/sh/init.sh'
    echo 'Unattended-Upgrade::Origins-Pattern {'
    printf '  "%s";\n' "${origins[@]}"
    echo '};'
    echo 'Unattended-Upgrade::Remove-Unused-Dependencies "true";'
    echo 'Unattended-Upgrade::Automatic-Reboot "false";'
  } | write_file "/etc/apt/apt.conf.d/52auto-security-upgrades" "0644" "root" "root"

  systemctl enable --now unattended-upgrades
  systemctl restart unattended-upgrades
}

configure_shell_history() {
  local settings="/etc/profile.d/99-history-settings.sh"
  local hook="[ -r ${settings} ] && . ${settings}"
  local rc_file
  local user
  local uid
  local home_dir

  write_file "${settings}" "0644" "root" "root" <<'EOF'
# Managed by public/sh/init.sh
[ -n "${BASH_VERSION:-}" ] || return 0
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

  # Interactive shells that are not login shells skip /etc/profile.d.
  if [[ -f /etc/bash.bashrc ]] && ! grep -qxF "${hook}" /etc/bash.bashrc; then
    printf '\n# Managed by public/sh/init.sh\n%s\n' "${hook}" >> /etc/bash.bashrc
    log "Added history settings to /etc/bash.bashrc"
  fi

  # ~/.bashrc runs after both files above, and the stock one sets its own short
  # history limits. New users get it from /etc/skel.
  disable_bashrc_history_settings /etc/skel/.bashrc "${settings}"
  while IFS=: read -r user _ uid _ _ home_dir _; do
    if [[ "${uid}" -eq 0 || "${uid}" -ge 1000 ]]; then
      rc_file="${home_dir}/.bashrc"
      disable_bashrc_history_settings "${rc_file}" "${settings}"
    fi
  done < /etc/passwd
}

disable_bashrc_history_settings() {
  local rc_file="$1"
  local settings="$2"
  local pattern='^[[:space:]]*(export[[:space:]]+)?HIST(SIZE|FILESIZE|CONTROL)='

  if [[ -f "${rc_file}" ]] && grep -Eq "${pattern}" "${rc_file}"; then
    sed -i -E "/${pattern}/ s|^|# Set in ${settings}: |" "${rc_file}"
    log "Disabled history limits in ${rc_file}"
  fi
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
    etckeeper commit "Applied public/sh/init.sh"
    log "Committed /etc changes with etckeeper"
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

  if unit_file_exists 'certbot.timer'; then
    systemctl enable --now certbot.timer
    if systemctl is-enabled --quiet certbot.timer; then
      log "certbot.timer is enabled for automatic certificate renewals"
    else
      warn "certbot.timer is present but not enabled"
    fi
  elif unit_file_exists 'snap.certbot.renew.timer'; then
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

# /proc/self/loginuid exists only when the kernel is built with audit support.
kernel_has_audit() {
  [[ -e /proc/self/loginuid ]]
}

# Prints the ABIs of programs that can run on this kernel.
audit_abis() {
  case "$(uname -m)" in
    x86_64|aarch64)
      printf '%s\n' b64 b32
      ;;
    i?86|arm*)
      printf '%s\n' b32
      ;;
    *)
      printf '%s\n' b64
      ;;
  esac
}

# Syscall names differ between architectures: aarch64 has no open, chmod, unlink
# or rename, for example. auditctl rejects a rule with an unknown name.
audit_known_syscalls() {
  local abi="$1"
  shift
  local name
  local known=""

  for name in "$@"; do
    if ausyscall "${abi}" "${name}" --exact >/dev/null 2>&1; then
      known+="${known:+,}${name}"
    fi
  done
  printf '%s' "${known}"
}

# Usage: audit_syscall_rule <action> <filters> <syscall>...
audit_syscall_rule() {
  local action="$1"
  local filters="$2"
  shift 2
  local abi
  local syscalls

  while IFS= read -r abi; do
    syscalls="$(audit_known_syscalls "${abi}" "$@")"
    if [[ -n "${syscalls}" ]]; then
      printf -- '-a %s -F arch=%s -S %s %s\n' "${action}" "${abi}" "${syscalls}" "${filters}"
    fi
  done < <(audit_abis)
}

# Usage: audit_watch <permissions> <key> <path>...
audit_watch() {
  local permissions="$1"
  local key="$2"
  shift 2
  local path

  for path in "$@"; do
    # auditctl rejects a watch whose parent directory does not exist.
    if [[ -d "$(dirname "${path}")" ]]; then
      printf -- '-w %s -p %s -k %s\n' "${path}" "${permissions}" "${key}"
    fi
  done
}

# Usage: audit_exec_watch <key> <program>...
# The kernel stops at the first matching rule, so these programs also get the
# "exec" key: "ausearch -k exec" stays the full list of commands.
audit_exec_watch() {
  local key="$1"
  shift
  local program
  local program_path

  for program in "$@"; do
    program_path="$(command -v "${program}" || true)"
    if [[ -n "${program_path}" ]]; then
      printf -- '-w %s -p x -k %s -k exec\n' "${program_path}" "${key}"
    fi
  done
}

generate_audit_base_rules() {
  cat <<'EOF'
# Managed by public/sh/init.sh
-D
-b 8192
--backlog_wait_time 60000
-f 1
# Load the remaining rules after a bad one. auditctl still reports the failure.
-c
EOF
}

generate_audit_rules() {
  local www_uid
  local logged_in="-F auid!=unset"
  local admin_action="-F auid!=unset -F euid=0"
  local tool
  local -a exec_calls=(execve execveat)
  local -a delete_calls=(unlink unlinkat rename renameat renameat2 rmdir)
  local -a perm_calls=(
    chmod fchmod fchmodat fchmodat2
    chown fchown lchown fchownat chown32 fchown32 lchown32
    setxattr lsetxattr fsetxattr removexattr lremovexattr fremovexattr
  )

  cat <<'EOF'
# Managed by public/sh/init.sh
#
# Answers "who did what on this machine". Follows PCI DSS v4 requirement 10.2
# and the audit section of the CIS benchmarks.
#
# "auid" is the account that logged in. It survives sudo and su, so every event
# points to a person. "auid!=unset" covers all login sessions, direct root logins
# included, and leaves out daemons.
#
# The kernel stops at the first matching rule: specific rules go first.
#
# Reading the log:
#   ausearch -i -k exec --start today     every command, with its user and arguments
#   ausearch -i -ul pahaz --start today   everything one person did
#   ausearch -i -k identity               changes to accounts and passwords
#   ausearch -i -k access_denied          denied access attempts
#   aureport -au                          logins and failed logins
#   aureport -x --summary                 most used programs
EOF

  echo
  if [[ -d /etc/.git ]]; then
    echo "# etckeeper's own repository: changes in /etc are logged below."
    echo "-a never,exit -F dir=/etc/.git"
  fi

  echo
  echo "# 10.2.1.3: access to the audit logs. 10.3: protection of the logs."
  audit_watch rwa audit_log /var/log/audit
  echo
  echo "# 10.2.1.6: stopping the audit or changing what it records."
  audit_watch wa audit_config /etc/audit /etc/libaudit.conf
  audit_exec_watch audit_tools auditctl auditd augenrules ausearch aureport

  echo
  echo "# 10.2.1.5: accounts, passwords and privileges."
  audit_watch wa identity /etc/passwd /etc/group /etc/shadow /etc/gshadow /etc/security/opasswd
  audit_watch wa auth_config \
    /etc/sudoers /etc/sudoers.d /etc/pam.conf /etc/pam.d /etc/security \
    /etc/nsswitch.conf /etc/login.defs
  audit_watch wa ssh_config /etc/ssh/sshd_config /etc/ssh/sshd_config.d
  echo "# SSH key directories are in 40-init-sh-local.rules."

  echo
  echo "# Login records: changing them hides who was here."
  audit_watch wa session_log \
    /var/log/lastlog /var/log/faillog /var/log/tallylog /var/log/wtmp /var/log/btmp \
    /run/utmp /var/lib/wtmpdb /var/lib/lastlog

  echo
  echo "# Ways to stay on the machine or to change what runs on it."
  audit_watch wa persistence \
    /etc/crontab /etc/cron.d /etc/cron.hourly /etc/cron.daily /etc/cron.weekly /etc/cron.monthly \
    /var/spool/cron /etc/systemd/system /etc/rc.local \
    /etc/ld.so.preload /etc/ld.so.conf /etc/ld.so.conf.d \
    /etc/profile /etc/profile.d /etc/bash.bashrc /etc/environment \
    /etc/modprobe.d /etc/modules /etc/modules-load.d

  echo
  echo "# System and security configuration."
  audit_watch wa system_config \
    /etc/hosts /etc/hostname /etc/network /etc/netplan /etc/sysctl.conf /etc/sysctl.d \
    /etc/apt/sources.list /etc/apt/sources.list.d /etc/apt/apt.conf.d /etc/apt/trusted.gpg.d \
    /etc/ufw /etc/fail2ban /etc/nginx /etc/letsencrypt /etc/apparmor /etc/apparmor.d
  audit_syscall_rule "always,exit" "${logged_in} -F key=system_config" sethostname setdomainname

  echo
  echo "# Docker access equals root access."
  audit_watch x docker /usr/bin/docker

  echo
  echo "# 10.6: clock changes make the timeline of events unreliable."
  audit_watch wa time_change /etc/localtime /etc/timezone
  audit_syscall_rule "always,exit" "${logged_in} -F key=time_change" \
    adjtimex settimeofday stime clock_settime clock_settime64 clock_adjtime clock_adjtime64

  echo
  echo "# Kernel modules and reboots, whoever does it."
  audit_syscall_rule "always,exit" "-F key=modules" init_module finit_module delete_module
  audit_syscall_rule "always,exit" "-F key=power" reboot kexec_load kexec_file_load

  echo
  echo "# Mounting file systems and attaching to other processes."
  audit_syscall_rule "always,exit" "${logged_in} -F key=mounts" mount umount umount2 move_mount
  audit_syscall_rule "always,exit" "${logged_in} -F key=ptrace" ptrace

  echo
  echo "# 10.2.1.4: denied access attempts."
  audit_syscall_rule "always,exit" "-F exit=-EACCES ${logged_in} -F key=access_denied" \
    open openat openat2 creat truncate truncate64 ftruncate ftruncate64 open_by_handle_at
  audit_syscall_rule "always,exit" "-F exit=-EPERM ${logged_in} -F key=access_denied" \
    open openat openat2 creat truncate truncate64 ftruncate ftruncate64 open_by_handle_at

  echo
  echo "# 10.2.1.7: system-level objects. 10.3.2: the logs of other services."
  echo "-a always,exit -F dir=/etc -F perm=wa ${logged_in} -F key=etc_change"
  echo "-a always,exit -F dir=/var/log -F perm=wa ${logged_in} -F key=log_change"

  echo
  echo "# 10.2.1.2: files deleted and permissions changed with admin rights."
  echo "# Package managers do this thousands of times, and their commands are logged."
  for tool in /usr/bin/dpkg /usr/bin/apt /usr/bin/apt-get; do
    audit_syscall_rule "never,exit" "-F exe=${tool}" "${delete_calls[@]}" "${perm_calls[@]}"
  done
  audit_syscall_rule "always,exit" "${admin_action} -F key=delete" "${delete_calls[@]}"
  audit_syscall_rule "always,exit" "${admin_action} -F key=perm_mod" "${perm_calls[@]}"

  echo
  echo "# 10.2.1.2: commands. Getting root through a setuid program, like sudo and su, goes first."
  audit_syscall_rule "always,exit" "-C uid!=euid -F euid=0 -F key=priv_esc -F key=exec" "${exec_calls[@]}"
  if www_uid="$(id -u www-data 2>/dev/null)"; then
    echo "# The web server has no reason to start programs: this is how a web shell looks."
    audit_syscall_rule "always,exit" "-F uid=${www_uid} -F key=web_exec -F key=exec" "${exec_calls[@]}"
  fi
  audit_syscall_rule "always,exit" "${logged_in} -F key=exec" "${exec_calls[@]}"

  echo
  if [[ "${AUDIT_IMMUTABLE}" == "1" ]]; then
    echo "# 10.3.2: nobody, root included, can change the rules until the next reboot."
    echo "-e 2"
  else
    echo "-e 1"
  fi
}

# Watches that depend on what exists on the machine. auditd runs this script on
# every start, so accounts and Docker added later are covered after a reboot.
install_audit_refresh_script() {
  write_file "${AUDIT_REFRESH_SCRIPT}" "0755" "root" "root" <<'EOF'
#!/usr/bin/env bash
# Managed by public/sh/init.sh
set -euo pipefail
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

dst="/etc/audit/rules.d/40-init-sh-local.rules"
tmp="$(mktemp)"
trap 'rm -f "${tmp}"' EXIT

{
  echo "# Managed by public/sh/init.sh (generated by init-audit-refresh)"
  getent passwd | while IFS=: read -r _ _ uid _ _ home_dir _; do
    if [[ "${uid}" -eq 0 || "${uid}" -ge 1000 ]] && [[ -d "${home_dir}/.ssh" ]]; then
      echo "-w ${home_dir}/.ssh -p wa -k ssh_keys"
    fi
  done | sort -u
  if [[ -d /etc/docker ]]; then
    echo "-w /etc/docker -p wa -k docker"
  fi
} > "${tmp}"

if ! cmp -s "${tmp}" "${dst}"; then
  install -D -m 0640 -o root -g root "${tmp}" "${dst}"
fi
EOF

  write_file "/etc/systemd/system/auditd.service.d/10-init-sh.conf" "0644" "root" "root" <<EOF
# Managed by public/sh/init.sh
[Service]
ExecStartPre=-${AUDIT_REFRESH_SCRIPT}
EOF
  systemctl daemon-reload
}

remove_old_audit_rules() {
  local rule_name
  # Files that earlier versions of this script installed.
  local -a old_rules=(
    10-base 10-base-config 10-loginuid 11-loginuid 12-cont-fail 20-identity
    22-ignore-chrony 30-pci-dss 31-privileged 32-power-abuse 40-kernel-modules
    41-containers 42-injection 43-module-load 44-installers 45-power-abuse
    50-software-installers 60-local-extra
  )

  for rule_name in "${old_rules[@]}"; do
    if [[ -f "${AUDIT_RULES_DIR}/${rule_name}.rules" ]]; then
      rm -f "${AUDIT_RULES_DIR}/${rule_name}.rules"
      log "Removed old audit rule file ${rule_name}.rules"
    fi
  done
}

configure_auditd_daemon() {
  local config="/etc/audit/auditd.conf"
  local disk_mb
  local total_mb
  local file_mb

  if [[ ! -f "${config}" ]]; then
    warn "${config} is missing; skipping audit log limits"
    return 0
  fi

  if [[ -n "${AUDIT_LOG_TOTAL_MB}" ]]; then
    total_mb="${AUDIT_LOG_TOTAL_MB}"
  else
    # Small SD cards get a smaller limit than servers.
    disk_mb="$(df -Pm /var/log | awk 'NR == 2 { print $2 }')"
    total_mb=$((disk_mb / 20))
    if [[ "${total_mb}" -lt 50 ]]; then
      total_mb=50
    elif [[ "${total_mb}" -gt 500 ]]; then
      total_mb=500
    fi
  fi
  file_mb=$((total_mb / AUDIT_LOG_FILES))
  if [[ "${file_mb}" -lt 1 ]]; then
    file_mb=1
  fi

  set_config_value "${config}" "max_log_file" "${file_mb}"
  set_config_value "${config}" "num_logs" "${AUDIT_LOG_FILES}"
  set_config_value "${config}" "max_log_file_action" "ROTATE"
  set_config_value "${config}" "log_format" "ENRICHED"
  set_config_value "${config}" "space_left" "25%"
  set_config_value "${config}" "space_left_action" "SYSLOG"
  set_config_value "${config}" "admin_space_left" "10%"
  set_config_value "${config}" "admin_space_left_action" "SUSPEND"
  set_config_value "${config}" "disk_full_action" "SUSPEND"
  set_config_value "${config}" "disk_error_action" "SUSPEND"
  set_config_value "${config}" "flush" "INCREMENTAL_ASYNC"
  set_config_value "${config}" "freq" "50"
  set_config_value "${config}" "name_format" "HOSTNAME"
  set_config_value "${config}" "write_logs" "yes"
  set_config_value "${config}" "priority_boost" "4"
  set_config_value "${config}" "overflow_action" "SYSLOG"
  log "Audit logs are limited to about ${total_mb} MB (${AUDIT_LOG_FILES} files of ${file_mb} MB)"
}

load_audit_rules() {
  local state
  local output

  output="$(auditctl -s 2>/dev/null || true)"
  state="$(awk '$1 == "enabled" { print $2; exit }' <<< "${output}")"
  if [[ "${state}" == "2" ]]; then
    output="$(augenrules --check 2>&1 || true)"
    if [[ "${output}" == *"changed"* ]]; then
      warn "Audit rules are locked until the next reboot; the new rules will apply after it"
    else
      log "Audit rules are locked and up to date"
    fi
    return 0
  fi

  if ! output="$(augenrules --load 2>&1)"; then
    warn "Failed to load audit rules: ${output}"
    return 1
  fi
  log "Audit rules loaded"
}

configure_auditd() {
  if ! kernel_has_audit || ! command -v auditctl >/dev/null 2>&1 || ! auditctl -s >/dev/null 2>&1; then
    warn "This kernel or container does not support audit; skipping auditd setup"
    return 0
  fi

  remove_old_audit_rules
  install_audit_refresh_script
  "${AUDIT_REFRESH_SCRIPT}"
  generate_audit_base_rules | write_file "${AUDIT_RULES_DIR}/10-init-sh-base.rules" "0640" "root" "root"
  generate_audit_rules | write_file "${AUDIT_RULES_DIR}/50-init-sh.rules" "0640" "root" "root"
  configure_auditd_daemon

  # Load first: the restart below loads the same rules but hides any errors.
  load_audit_rules
  systemctl enable auditd
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

health_ok() {
  log " - $*"
}

health_problem() {
  warn " - $*"
  HEALTH_PROBLEMS=$((HEALTH_PROBLEMS + 1))
}

health_check() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    health_ok "${label}: OK"
  else
    health_problem "${label}: FAIL"
  fi
}

health_ssh() {
  local ssh_unit
  local user
  local config
  local port
  local methods
  local stale_pids
  local ufw_status

  ssh_unit="$(pick_unit_name "ssh" "sshd")"
  ufw_status="$(ufw status 2>/dev/null || true)"

  health_check "sshd config" sshd -t
  for user in root "${ADMIN_USER}"; do
    health_check "SSH key login for ${user}" sshd_allows_key_login "${user}"
    config="$(sshd_config_for_user "${user}" || true)"
    if grep -qx 'passwordauthentication no' <<< "${config}"; then
      health_ok "PasswordAuthentication for ${user}: no"
    else
      health_problem "PasswordAuthentication for ${user}: not disabled in the sshd config"
    fi
  done

  if systemctl is-active --quiet "${ssh_unit}" || systemctl is-active --quiet ssh.socket; then
    health_ok "${ssh_unit} service: active"
  else
    health_problem "${ssh_unit} service: not active"
  fi
  if systemctl is-enabled --quiet "${ssh_unit}" 2>/dev/null || systemctl is-enabled --quiet ssh.socket 2>/dev/null; then
    health_ok "${ssh_unit} starts at boot"
  else
    health_problem "${ssh_unit} does not start at boot"
  fi

  while IFS= read -r port; do
    methods="$(sshd_live_auth_methods "${port}")"
    case "${methods}" in
      "")
        health_problem "Port ${port}: could not ask the running sshd for its login methods"
        ;;
      *password*|*keyboard-interactive*)
        health_problem "Port ${port}: the running sshd still offers: ${methods}"
        ;;
      *)
        health_ok "Port ${port}: the running sshd offers only: ${methods}"
        ;;
    esac
    if grep -Eq "^${port}(/tcp)?[[:space:]]+ALLOW" <<< "${ufw_status}"; then
      health_ok "Port ${port}: allowed in ufw"
    else
      health_problem "Port ${port}: not allowed in ufw"
    fi
  done < <(get_ssh_ports)

  stale_pids="$(sshd_stale_listeners "${ssh_unit}" | paste -sd' ' -)"
  if [[ -n "${stale_pids}" ]]; then
    health_problem "Old sshd listeners survived the restart (PID ${stale_pids}); they keep their old settings until stopped or a reboot"
  else
    health_ok "No old sshd listeners"
  fi
}

health_admin_user() {
  if grep -q 'NOPASSWD: ALL' <<< "$(sudo -l -U "${ADMIN_USER}" 2>/dev/null || true)"; then
    health_ok "Passwordless sudo for ${ADMIN_USER}: OK"
  else
    health_problem "Passwordless sudo for ${ADMIN_USER}: FAIL"
  fi
}

health_fail2ban() {
  local jail
  local logpath

  if ! systemctl is-active --quiet fail2ban; then
    health_problem "fail2ban service: not active"
    return 0
  fi
  health_ok "fail2ban service: active"

  for jail in sshd nginx-http-auth nginx-botsearch; do
    if fail2ban-client status "${jail}" >/dev/null 2>&1; then
      health_ok "fail2ban jail ${jail}: running"
    else
      health_problem "fail2ban jail ${jail}: not running"
    fi
  done

  for jail in nginx-http-auth nginx-botsearch; do
    logpath="$(fail2ban-client get "${jail}" logpath 2>/dev/null || true)"
    if [[ "${logpath}" == *"/var/log/nginx/"* ]]; then
      health_ok "fail2ban jail ${jail}: reads the nginx log"
    else
      health_problem "fail2ban jail ${jail}: does not read the nginx log"
    fi
  done
}

health_auditd() {
  local rules
  local key
  local -a missing=()

  if ! kernel_has_audit; then
    log " - auditd: this kernel does not support audit"
    return 0
  fi
  if ! systemctl is-active --quiet auditd; then
    health_problem "auditd service: not active"
    return 0
  fi
  health_ok "auditd service: active"

  rules="$(auditctl -l 2>/dev/null || true)"
  for key in audit_log audit_config identity auth_config ssh_keys persistence modules access_denied delete perm_mod priv_esc exec; do
    if ! grep -Eq "(-k |key=)${key}( |\$)" <<< "${rules}"; then
      missing+=("${key}")
    fi
  done
  if [[ "${#missing[@]}" -gt 0 ]]; then
    health_problem "audit rules are missing for: ${missing[*]}"
  else
    health_ok "audit rules: $(wc -l <<< "${rules}") loaded"
  fi

  if [[ "$(awk '$1 == "enabled" { print $2; exit }' <<< "$(auditctl -s 2>/dev/null || true)")" =~ ^[12]$ ]]; then
    health_ok "audit: recording"
  else
    health_problem "audit: disabled or unavailable"
  fi
}

health_summary() {
  log "Health summary:"

  health_ssh
  health_admin_user

  if systemctl is-active --quiet nginx; then
    health_ok "nginx service: active"
  else
    health_problem "nginx service: not active"
  fi

  if grep -q '^Status: active' <<< "$(ufw status 2>/dev/null || true)"; then
    health_ok "ufw: active"
  else
    health_problem "ufw: not active"
  fi

  health_fail2ban

  if (systemctl is-enabled --quiet certbot.timer 2>/dev/null && systemctl is-active --quiet certbot.timer 2>/dev/null) || \
     (systemctl is-enabled --quiet snap.certbot.renew.timer 2>/dev/null && systemctl is-active --quiet snap.certbot.renew.timer 2>/dev/null); then
    health_ok "certbot.timer: enabled and active"
  else
    health_problem "certbot.timer: not enabled/active"
  fi

  if systemctl is-enabled --quiet unattended-upgrades; then
    health_ok "unattended-upgrades: enabled"
  else
    health_problem "unattended-upgrades: not enabled"
  fi

  health_auditd
}

# Things to do by hand: these do not make the run fail.
print_operator_notes() {
  local kernel_state

  if command -v docker >/dev/null 2>&1; then
    warn "Docker is installed: ports it publishes bypass ufw. Bind them to 127.0.0.1 or use the DOCKER-USER chain."
  fi

  if [[ -f /var/run/reboot-required ]]; then
    warn "A reboot is required: $(paste -sd' ' /var/run/reboot-required.pkgs 2>/dev/null || true)"
  elif command -v needrestart >/dev/null 2>&1; then
    kernel_state="$(needrestart -b -r l 2>/dev/null | awk '$1 == "NEEDRESTART-KSTA:" { print $2 }' || true)"
    if [[ "${kernel_state}" == "2" || "${kernel_state}" == "3" ]]; then
      warn "A reboot is required: a newer kernel is installed"
    fi
  fi
}

install_packages() {
  local pkg

  # Required packages for baseline server setup.
  local base_packages=(
    ca-certificates
    certbot
    curl
    fail2ban
    python3-systemd
    ufw
    etckeeper
    gnupg
    htop
    iproute2
    ncdu
    nginx
    openssh-server
    sudo
    unattended-upgrades
    git
  )

  # Optional packages: useful for diagnostics and incident response.
  local optional_packages=(
    software-properties-common
    needrestart
    net-tools
    bmon
    iftop
    iperf3
    bind9-dnsutils
    mtr-tiny
    netcat-openbsd
    tcpdump
    lsof
    sysstat
    jq
    ripgrep
    rsync
    iotop
    atop
    python3-certbot-nginx
  )

  if kernel_has_audit; then
    base_packages+=(auditd)
  else
    warn "This kernel does not support audit; not installing auditd"
  fi

  log "Updating package index"
  apt_update

  run_step "Upgrading packages" apt_get upgrade

  log "Installing base packages"
  apt_get install "${base_packages[@]}"

  log "Installing optional diagnostic/security packages"
  for pkg in "${optional_packages[@]}"; do
    if apt-cache show "${pkg}" >/dev/null 2>&1; then
      if apt_get install "${pkg}"; then
        log "Installed optional package: ${pkg}"
      else
        warn "Failed to install optional package: ${pkg}"
      fi
    else
      warn "Optional package not found in apt repo: ${pkg}"
    fi
  done
}

main() {
  local ssh_key

  enable_debug_mode

  # 1) Boards without a battery-backed clock boot with the wrong time, and then
  # HTTPS and apt signature checks fail.
  run_step "Time synchronization" force_time_sync

  # 2) Get the key before the long package upgrade: without it there is no point.
  ensure_curl
  log "Fetching SSH key from ${SSH_KEY_URL}"
  ssh_key="$(fetch_primary_ssh_key)"

  # 3) Update the system and install tooling.
  install_packages

  # 4) Set up access. If this fails, stop before password login is turned off.
  log "Setting up SSH access for root and ${ADMIN_USER}"
  configure_root_ssh_key "${ssh_key}"
  configure_admin_user "${ssh_key}"
  assert_ssh_access_preflight "${ssh_key}"
  warn_about_ssh_login_users

  # 5) Configure security controls and core services, each on its own.
  run_step "SSH hardening" configure_ssh
  run_step "Firewall" configure_ufw
  run_step "nginx" configure_nginx
  run_step "fail2ban" configure_fail2ban
  run_step "Automatic updates" configure_unattended_upgrades
  run_step "Audit" configure_auditd
  run_step "Shell history" configure_shell_history
  run_step "Certbot renewal" configure_certbot_renewal
  run_step "etckeeper" configure_etckeeper

  # 6) Run post-configuration checks and print operator hints.
  health_summary
  print_operator_notes

  if [[ "${#FAILED_STEPS[@]}" -gt 0 || "${HEALTH_PROBLEMS}" -gt 0 ]]; then
    warn "Bootstrap finished with problems. Failed steps: ${FAILED_STEPS[*]:-none}. Failed health checks: ${HEALTH_PROBLEMS}."
    exit 1
  fi

  log "Bootstrap complete."
  print_certbot_hint
}

main "$@"
