import { createRouter, createWebHashHistory } from 'vue-router'
import HomePage from '../pages/HomePage.vue'
import BasicsPage from '../pages/BasicsPage.vue'
import ItineraryPage from '../components/Itinerary.vue'
import PhotosPage from '../pages/PhotosPage.vue'
import PreTripPage from '../pages/PreTripPage.vue'
import GroceriesPage from '../pages/GroceriesPage.vue'
import WhaleSightingsPage from '../pages/WhaleSightingsPage.vue'
import GhostStoriesPage from '../pages/GhostStoriesPage.vue'
import AdminPage from '../pages/AdminPage.vue'
import LoginPage from '../pages/LoginPage.vue'
import AuthCallbackPage from '../pages/AuthCallbackPage.vue'
import { bypassAuth, hasSupabaseConfig } from '../lib/supabaseClient'
import { getCurrentSession, setPostLoginRedirect } from '../lib/authAccess'

function safeRedirectPath(value) {
  const candidate = String(value || '').trim()
  if (!candidate.startsWith('/')) return '/'
  if (candidate.startsWith('//')) return '/'
  return candidate
}

function redirectToLogin(toPath) {
  const redirect = safeRedirectPath(toPath)
  setPostLoginRedirect(redirect)
  return {
    path: '/login',
    query: { redirect },
  }
}

function extractMalformedAuthParams(pathValue) {
  const rawPath = String(pathValue || '')
  const decoded = decodeURIComponent(rawPath)
  const hashIndex = decoded.indexOf('#')
  if (hashIndex < 0) return null

  const fragment = decoded.slice(hashIndex + 1).replace(/^\//, '')
  if (!fragment) return null

  const params = new URLSearchParams(fragment)
  const hasAuthPayload = (
    params.has('access_token')
    || params.has('refresh_token')
    || params.has('code')
    || params.has('error')
    || params.has('error_code')
    || params.has('error_description')
  )
  if (!hasAuthPayload) return null

  const query = {}
  for (const [key, value] of params.entries()) {
    if (value) query[key] = value
  }
  return Object.keys(query).length ? query : null
}

async function hasActiveSession() {
  const session = await getCurrentSession().catch(() => null)
  return Boolean(session?.user)
}

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/auth/callback', component: AuthCallbackPage, meta: { breadcrumb: 'Auth Callback' } },
    { path: '/login', component: LoginPage, meta: { breadcrumb: 'Login' } },
    { path: '/', component: HomePage, meta: { requiresAuth: true } },
    { path: '/basics', component: BasicsPage, meta: { requiresAuth: true, breadcrumb: 'Basics' } },
    { path: '/itinerary', component: ItineraryPage, meta: { requiresAuth: true, breadcrumb: 'Itinerary' } },
    { path: '/photos', component: PhotosPage, meta: { requiresAuth: true, breadcrumb: 'Photos' } },
    { path: '/pre-trip', component: PreTripPage, meta: { requiresAuth: true, breadcrumb: 'Pre-Trip Prep' } },
    { path: '/groceries', component: GroceriesPage, meta: { requiresAuth: true, breadcrumb: 'Groceries' } },
    { path: '/whales', component: WhaleSightingsPage, meta: { requiresAuth: true, breadcrumb: 'Whale Sightings' } },
    { path: '/ghost-stories', component: GhostStoriesPage, meta: { requiresAuth: true, breadcrumb: 'Ghost Stories' } },
    { path: '/admin', component: AdminPage, meta: { requiresAuth: true, breadcrumb: 'Admin' } },
    { path: '/:pathMatch(.*)*', redirect: '/login' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

router.beforeEach(async (to) => {
  const malformedAuthQuery = extractMalformedAuthParams(to.path)
  if (malformedAuthQuery) {
    return {
      path: '/auth/callback',
      query: malformedAuthQuery,
      replace: true,
    }
  }

  if (bypassAuth) {
    return true
  }

  if (!hasSupabaseConfig) {
    return true
  }

  const needsAuth = to.matched.some((record) => record.meta.requiresAuth)
  const isLogin = to.path === '/login'
  const forceLogin = to.query.reauth === '1'

  try {
    if (needsAuth) {
      const signedIn = await hasActiveSession()
      if (!signedIn) return redirectToLogin(to.fullPath)

      return true
    }

    if (isLogin && forceLogin) {
      return true
    }

    if (isLogin) {
      if (await hasActiveSession()) {
        return safeRedirectPath(to.query.redirect)
      }
    }

    return true
  } catch {
    if (needsAuth) {
      if (await hasActiveSession()) {
        // Avoid forcing users to /login on transient profile/network failures.
        return true
      }
      return redirectToLogin(to.fullPath)
    }

    return true
  }
})

export default router
