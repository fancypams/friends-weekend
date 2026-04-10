import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { execSync } from 'node:child_process'

function getGitSha() {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'unknown'
  }
}

const appVersion = process.env.npm_package_version || '0.0.0'
const appGitSha = getGitSha()

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_GIT_SHA__: JSON.stringify(appGitSha),
  },
})
