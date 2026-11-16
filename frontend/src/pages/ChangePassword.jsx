import Settings from './Settings'

// Change Password (account menu, top right): the password part of Settings, on its own
export default function ChangePassword() {
  return <Settings only="password" />
}
