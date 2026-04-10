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
]

const extrasLinks = [
  { to: '/whales', label: 'Whale Sightings' },
  { to: '/ghost-stories', label: 'Ghost Stories' },
]

const hiddenNavPaths = new Set(['/login', '/auth/callback'])
const showDesktopNav = computed(() => !hiddenNavPaths.has(route.path))

const extrasActive = computed(() => extrasLinks.some((l) => route.path === l.to))

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

    <div class="extras-wrapper">
      <button type="button" class="nav-link extras-trigger" :class="{ active: extrasActive }">
        Extras
        <svg class="extras-chevron" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M2 4l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <div class="extras-dropdown">
        <div class="extras-dropdown-panel">
          <router-link
            v-for="link in extrasLinks"
            :key="link.to"
            :to="link.to"
            class="extras-item"
            :class="{ active: isActivePath(link.to) }"
          >
            {{ link.label }}
          </router-link>
        </div>
      </div>
    </div>

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

/* ── Extras dropdown ── */
.extras-wrapper {
  position: relative;
}

.extras-trigger {
  display: flex;
  align-items: center;
  gap: 3px;
}

.extras-chevron {
  transition: transform 0.2s ease;
}

.extras-wrapper:hover .extras-chevron {
  transform: rotate(180deg);
}

.extras-dropdown {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  padding-top: 8px;
  min-width: 152px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
  z-index: 100;
}

.extras-dropdown-panel {
  background: var(--bg-white);
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  overflow: hidden;
}

.extras-wrapper:hover .extras-dropdown {
  opacity: 1;
  pointer-events: all;
}

.extras-item {
  display: block;
  padding: 11px 16px;
  font-family: var(--font-sign);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--forest);
  text-decoration: none;
  transition: background 0.15s, color 0.15s;
}

.extras-item + .extras-item {
  border-top: 1px solid rgba(92, 138, 150, 0.15);
}

.extras-item:hover {
  background: var(--parchment);
  color: var(--terracotta);
}

.extras-item.active {
  color: var(--terracotta);
}

@media (min-width: 900px) {
  .page-nav {
    display: inline-flex;
  }
}
</style>
