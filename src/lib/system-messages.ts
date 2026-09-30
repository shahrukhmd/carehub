// A system message is live while active and inside its (optional) from/to window.
export function isMessageLive(m: { active: boolean; activeFrom: Date | null; activeTo: Date | null }, now = new Date()) {
  return m.active && (!m.activeFrom || m.activeFrom <= now) && (!m.activeTo || m.activeTo >= now);
}
