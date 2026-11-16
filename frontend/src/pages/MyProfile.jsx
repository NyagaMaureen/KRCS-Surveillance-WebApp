import Settings from './Settings'

// My Profile (account menu, top right): the profile part of Settings, without the settings tabs
export default function MyProfile() {
  return <Settings only="profile" />
}
