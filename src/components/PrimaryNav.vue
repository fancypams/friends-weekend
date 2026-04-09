<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { globalSignOut } from '../lib/authAccess'

const route = useRoute()
const router = useRouter()

const links = [
  { to: '/', label: 'Home' },
  { to: '/basics', label: 'Basics' },
  { to: '/itinerary', label: 'Itinerary' },
  { to: '/pre-trip', label: 'Pre-Trip Prep' },
  { to: '/groceries', label: 'Groceries' },
  { to: '/photos', label: 'Photos' },
  { to: '/whales', label: 'Whale Sightings' },
]

const showDesktopNav = computed(() => route.path !== '/login')

function isActivePath(path) {
  if (path === '/') return route.path === '/'
  return route.path === path
}

async function signOut() {
  await globalSignOut().catch(() => {})
  await router.replace('/login')
}
</script>

<template>
  <nav v-if="showDesktopNav" class="page-nav" aria-label="Primary navigation">
    <router-link
      v-for="link in links"
      :key="link.to"
      :to="link.to"
      class="nav-link"
      :class="{ active: isActivePath(link.to) }"
    >
      {{ link.label }}
    </router-link>
    <button type="button" class="nav-link nav-signout" @click="signOut">Sign out</button>
  </nav>
</template>

<style scoped>
.page-nav {
  display: none;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  padding: 6px 10px;
  border-radius: 999px;
  width: fit-content;
  background: rgba(205, 225, 230, 0.72);
  border: 1px solid rgba(92, 138, 150, 0.24);
  backdrop-filter: blur(2px);
}

.nav-link {
  border: 0;
  background: transparent;
  text-decoration: none;
  font-family: var(--font-sign);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--sky-label);
  line-height: 1;
  padding: 6px 7px;
  border-radius: 999px;
  cursor: pointer;
}

.nav-link:hover {
  color: var(--terracotta);
  background: rgba(210, 229, 234, 0.7);
}

.nav-link.active {
  color: var(--terracotta);
}

.nav-signout {
  border-left: 1px solid rgba(92, 138, 150, 0.24);
  border-radius: 0;
  margin-left: 2px;
  padding-left: 10px;
}

@media (min-width: 900px) {
  .page-nav {
    display: inline-flex;
  }
}
</style>
