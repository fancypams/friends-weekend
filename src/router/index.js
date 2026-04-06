import { createRouter, createWebHashHistory } from 'vue-router'
import HomePage from '../pages/HomePage.vue'
import BasicsPage from '../pages/BasicsPage.vue'
import ItineraryPage from '../components/Itinerary.vue'
import PhotosPage from '../pages/PhotosPage.vue'
import LoginPage from '../pages/LoginPage.vue'
import { bypassAuth, hasSupabaseConfig } from '../lib/supabaseClient'
import { getAuthState, globalSignOut, setPostLoginRedirect } from '../lib/authAccess'

function safeRedirectPath(value) {
  const candidate = String(value || '').trim()
  if (!candidate.startsWith('/')) return '/'
  if (candidate.startsWith('//')) return '/'
  return candidate
}

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/login', component: LoginPage },
    { path: '/', component: HomePage, meta: { requiresAuth: true } },
    { path: '/basics', component: BasicsPage, meta: { requiresAuth: true } },
    { path: '/itinerary', component: ItineraryPage, meta: { requiresAuth: true } },
    { path: '/photos', component: PhotosPage, meta: { requiresAuth: true } },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

router.beforeEach(async (to) => {
  if (bypassAuth) {
    return true
  }

  if (!hasSupabaseConfig) {
    return true
  }

  const needsAuth = to.matched.some((record) => record.meta.requiresAuth)
  const isLogin = to.path === '/login'

  try {
    const state = await getAuthState()

    if (needsAuth) {
      if (!state.signedIn) {
        const redirect = safeRedirectPath(to.fullPath)
        setPostLoginRedirect(redirect)
        return {
          path: '/login',
          query: { redirect },
        }
      }

      if (!state.invited) {
        await globalSignOut()
        return {
          path: '/login',
          query: { blocked: '1' },
        }
      }

      return true
    }

    if (isLogin && state.signedIn && state.invited) {
      return safeRedirectPath(to.query.redirect)
    }

    return true
  } catch {
    if (needsAuth) {
      const redirect = safeRedirectPath(to.fullPath)
      setPostLoginRedirect(redirect)
      return {
        path: '/login',
        query: { redirect },
      }
    }

    return true
  }
})

export default router
