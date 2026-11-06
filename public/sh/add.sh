#!/bin/sh
# Adds the admin user "pahaz" to a server, and nothing else:
#   - creates the user (or keeps the existing one),
#   - gives it bash as the login shell when bash is installed,
#   - adds the first key from https://github.com/pahaz.keys,
#   - grants passwordless sudo when sudo is installed.
#
# It installs no packages, never removes keys or files and never touches sshd.
# Running it again changes nothing.
#
# Works with POSIX sh on Linux (Debian, Ubuntu, RHEL, Fedora, Arch, SUSE,
# Alpine/BusyBox) and FreeBSD.
#
#   curl -fsSL https://pahaz.8iq.dev/sh/add.sh | sudo sh
#   wget -qO- https://pahaz.8iq.dev/sh/add.sh | sudo sh
#
# Overrides: ADD_USER=name, ADD_KEY_URL=https://...

set -eu

# "su" without "-" leaves the sbin directories out of PATH.
PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"
export PATH
umask 077

ADD_USER="${ADD_USER:-pahaz}"
ADD_KEY_URL="${ADD_KEY_URL:-https://github.com/pahaz.keys}"
TMP_FILES=""

log() { printf '[add.sh] %s\n' "$*"; }
warn() { printf '[add.sh] WARNING: %s\n' "$*" >&2; }
die() { printf '[add.sh] ERROR: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

cleanup() {
  # shellcheck disable=SC2086
  [ -z "${TMP_FILES}" ] || rm -f ${TMP_FILES}
}

# Sets _tmp; not called via $(...) so TMP_FILES survives for cleanup.
new_tmp() {
  _tmp="$(mktemp)" || die "mktemp failed"
  TMP_FILES="${TMP_FILES} ${_tmp}"
}

passwd_field() {
  # $1 user, $2 field number (6 = home, 7 = shell)
  if have getent; then
    getent passwd "$1" | cut -d: -f"$2"
  else
    awk -F: -v u="$1" -v f="$2" '$1 == u { print $f; exit }' /etc/passwd
  fi
}

download() {
  if have curl; then
    curl -fsSL --retry 3 --max-time 30 "$1"
  elif have wget; then
    wget -q -T 30 -O - "$1"
  elif have fetch; then
    fetch -q -T 30 -o - "$1"
  else
    die "Need curl, wget or fetch to download ${1}"
  fi
}

fetch_key() {
  case "${ADD_KEY_URL}" in
    https://*) ;;
    *) die "ADD_KEY_URL must use https:// (got: ${ADD_KEY_URL})" ;;
  esac
  _keys="$(download "${ADD_KEY_URL}")" || die "Failed to download ${ADD_KEY_URL}"
  # The first key of the account, with the type and body only.
  _key="$(printf '%s\n' "${_keys}" | awk '
    NF >= 2 && $1 ~ /^(ssh-(rsa|ed25519)|ecdsa-sha2-nistp(256|384|521)|sk-(ssh-ed25519|ecdsa-sha2-nistp256)@openssh\.com)$/ \
      && $2 ~ /^[A-Za-z0-9+\/=]+$/ { print $1 " " $2; exit }
  ')"
  [ -n "${_key}" ] || die "No valid SSH key found at ${ADD_KEY_URL}"
  printf '%s\n' "${_key}"
}

pick_shell() {
  for _s in /bin/bash /usr/bin/bash /usr/local/bin/bash; do
    if [ -x "${_s}" ]; then printf '%s\n' "${_s}"; return 0; fi
  done
  _s="$(command -v bash 2>/dev/null || true)"
  if [ -n "${_s}" ]; then printf '%s\n' "${_s}"; return 0; fi
  for _s in /bin/sh /usr/bin/sh; do
    if [ -x "${_s}" ]; then printf '%s\n' "${_s}"; return 0; fi
  done
  die "No usable login shell found"
}

create_user() {
  _shell="$1"
  if have useradd; then
    useradd -m -U -s "${_shell}" "${ADD_USER}" 2>/dev/null \
      || useradd -m -s "${_shell}" "${ADD_USER}"
  elif have pw; then
    pw useradd -n "${ADD_USER}" -m -s "${_shell}" -w no
  elif have adduser; then
    # BusyBox: -D no password.
    adduser -D -s "${_shell}" "${ADD_USER}"
  else
    die "Need useradd, pw or adduser to create ${ADD_USER}"
  fi
  # "*" matches no password but, unlike "!", does not mark the account as
  # locked, so sshd still accepts key logins (e.g. on Alpine with UsePAM no).
  if [ -f /etc/shadow ]; then
    if have usermod; then
      usermod -p '*' "${ADD_USER}"
    elif have chpasswd; then
      printf '%s:*\n' "${ADD_USER}" | chpasswd -e >/dev/null
    fi
  fi
  log "Created user ${ADD_USER} with shell ${_shell}"
}

set_shell() {
  if have usermod; then
    usermod -s "$1" "${ADD_USER}"
  elif have pw; then
    pw usermod -n "${ADD_USER}" -s "$1"
  elif have chsh; then
    chsh -s "$1" "${ADD_USER}"
  else
    warn "Cannot change the shell of ${ADD_USER}: no usermod, pw or chsh"
    return 0
  fi
  log "Changed login shell of ${ADD_USER} to $1"
}

ensure_user() {
  _shell="$(pick_shell)"
  if id "${ADD_USER}" >/dev/null 2>&1; then
    log "User ${ADD_USER} already exists"
    _cur="$(passwd_field "${ADD_USER}" 7)"
    # Only replace shells that block logins or a plain sh when bash exists;
    # a shell the user picked (zsh, fish) stays.
    case "${_cur}" in
      ""|*/nologin|*/false)
        set_shell "${_shell}" ;;
      */sh)
        case "${_shell}" in */bash) set_shell "${_shell}" ;; esac ;;
    esac
  else
    create_user "${_shell}"
  fi
}

ensure_key() {
  _key="$1"
  _home="$(passwd_field "${ADD_USER}" 6)"
  [ -n "${_home}" ] || die "Cannot detect the home directory of ${ADD_USER}"
  _group="$(id -gn "${ADD_USER}")"

  if [ ! -d "${_home}" ]; then
    mkdir -p "${_home}"
    chown "${ADD_USER}:${_group}" "${_home}"
    chmod 0750 "${_home}"
  fi
  if [ ! -d "${_home}/.ssh" ]; then
    mkdir "${_home}/.ssh"
  fi
  chown "${ADD_USER}:${_group}" "${_home}/.ssh"
  chmod 0700 "${_home}/.ssh"

  _auth="${_home}/.ssh/authorized_keys"
  [ -e "${_auth}" ] || : > "${_auth}"
  chown "${ADD_USER}:${_group}" "${_auth}"
  chmod 0600 "${_auth}"

  # Match type and body as separate fields, ignoring options and comments.
  if awk -v t="${_key%% *}" -v b="${_key#* }" '
       { for (i = 1; i < NF; i++) if ($i == t && $(i + 1) == b) found = 1 }
       END { exit(found ? 0 : 1) }' "${_auth}"; then
    log "Key already present for ${ADD_USER}"
  else
    # Without a trailing newline the new key would be glued to the last one.
    if [ -s "${_auth}" ] && [ "$(tail -c 1 "${_auth}" | wc -l)" -eq 0 ]; then
      printf '\n' >> "${_auth}"
    fi
    printf '%s %s\n' "${_key}" "${ADD_USER}@github" >> "${_auth}"
    log "Added key for ${ADD_USER}"
  fi

  if have restorecon; then
    restorecon -R "${_home}/.ssh" 2>/dev/null || true
  fi
}

ensure_sudo() {
  if ! have sudo; then
    log "sudo is not installed, skipping sudo setup"
    return 0
  fi
  _sudoers=""
  for _f in /etc/sudoers /usr/local/etc/sudoers /usr/pkg/etc/sudoers; do
    if [ -f "${_f}" ]; then _sudoers="${_f}"; break; fi
  done
  [ -n "${_sudoers}" ] || { warn "sudo is installed but no sudoers file found, skipping"; return 0; }
  _dir="${_sudoers}.d"

  # If sudo already lets the user in without a password, leave it alone.
  if sudo -l -U "${ADD_USER}" 2>/dev/null | grep -q 'NOPASSWD: *ALL'; then
    log "Passwordless sudo already set for ${ADD_USER}"
    return 0
  fi

  if ! grep -Eq "^[[:space:]]*[#@]includedir[[:space:]]+${_dir}/?[[:space:]]*$" "${_sudoers}"; then
    warn "${_sudoers} does not include ${_dir}; not editing it. Add by hand: ${ADD_USER} ALL=(ALL) NOPASSWD: ALL"
    return 0
  fi
  have visudo || { warn "visudo not found, refusing to write sudoers without a check"; return 0; }

  # No dots in the name: sudo skips such files in includedir.
  _target="${_dir}/90-${ADD_USER}"
  if [ -e "${_target}" ]; then
    warn "${_target} exists but does not grant passwordless sudo; leaving it as is"
    return 0
  fi

  new_tmp
  printf '# Added by https://pahaz.8iq.dev/sh/add.sh\n%s ALL=(ALL) NOPASSWD: ALL\n' "${ADD_USER}" > "${_tmp}"
  # A broken file in sudoers.d stops sudo for everyone, so check it first.
  visudo -cqf "${_tmp}" || die "Generated sudoers rule failed visudo check"
  [ -d "${_dir}" ] || { mkdir -p "${_dir}"; chmod 0750 "${_dir}"; }
  chmod 0440 "${_tmp}"
  chown root "${_tmp}"
  chgrp 0 "${_tmp}" 2>/dev/null || true
  # Same directory, so the rename is atomic.
  mv "${_tmp}" "${_target}.tmp" && mv "${_target}.tmp" "${_target}" || die "Cannot install ${_target}"
  if ! visudo -cq >/dev/null 2>&1; then
    rm -f "${_target}"
    die "sudo config check failed after adding ${_target}; removed it again"
  fi
  log "Granted passwordless sudo to ${ADD_USER} (${_target})"
}

main() {
  [ "$(id -u)" -eq 0 ] || die "Run as root, e.g.: curl -fsSL https://pahaz.8iq.dev/sh/add.sh | sudo sh"
  case "${ADD_USER}" in
    ""|[!a-z_]*|*[!a-z0-9_-]*) die "Invalid user name: ${ADD_USER}" ;;
  esac
  trap cleanup EXIT
  trap 'exit 1' HUP INT TERM

  # Download first: if it fails, nothing on the server has changed.
  key="$(fetch_key)"
  ensure_user
  ensure_key "${key}"
  ensure_sudo
  log "Done: ssh ${ADD_USER}@<this-host>"
}

# Everything runs from here, so a download cut short by "curl | sh" runs nothing.
main "$@"
