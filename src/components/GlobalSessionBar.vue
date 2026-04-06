<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { bypassAuth, hasSupabaseConfig, supabase } from '../lib/supabaseClient'
import { getAuthState, globalSignOut } from '../lib/authAccess'

const router = useRouter()
const signingOut = ref(false)
const state = ref({
  signedIn: false,
  invited: false,
  profile: null,
})
let subscription = null

const visible = computed(() => !bypassAuth && hasSupabaseConfig && state.value.signedIn)
const email = computed(() => state.value.profile?.email || '')

async function syncState() {
  if (!hasSupabaseConfig || !supabase) {
    state.value = {
      signedIn: false,
      invited: false,
      profile: null,
    }
    return
  }

  try {
    state.value = await getAuthState()
  } catch {
    state.value = {
      signedIn: false,
      invited: false,
      profile: null,
    }
  }
}

async function logoutEverywhere() {
  signingOut.value = true
  try {
    await globalSignOut()
    await router.replace('/login')
  } finally {
    signingOut.value = false
  }
}

onMounted(async () => {
  await syncState()

  if (supabase) {
    const listener = supabase.auth.onAuthStateChange(async () => {
      await syncState()
    })

    subscription = listener.data.subscription
  }
})

onUnmounted(() => {
  if (subscription) {
    subscription.unsubscribe()
    subscription = null
  }
})
</script>

<template>
  <div v-if="visible" class="session-bar">
    <span class="session-email">{{ email }}</span>
    <button type="button" class="logout-btn" :disabled="signingOut" @click="logoutEverywhere">
      {{ signingOut ? 'Signing out…' : 'Logout' }}
    </button>
  </div>
</template>

<style scoped>
.session-bar {
  position: fixed;
  top: 10px;
  right: 10px;
  z-index: 120;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(15, 42, 34, 0.9);
  color: #fff;
  border-radius: 999px;
  padding: 6px 8px 6px 12px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.25);
  backdrop-filter: blur(4px);
}

.session-email {
  font-size: 12px;
  max-width: 180px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.logout-btn {
  border: 0;
  border-radius: 999px;
  background: #fff;
  color: #1A3329;
  font-size: 12px;
  font-weight: 700;
  padding: 5px 10px;
  cursor: pointer;
}

.logout-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

@media (max-width: 680px) {
  .session-bar {
    top: 8px;
    right: 8px;
    max-width: calc(100vw - 16px);
  }

  .session-email {
    max-width: 120px;
  }
}
</style>
