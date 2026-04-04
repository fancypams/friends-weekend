<script setup>
import HeroHeader from '../components/HeroHeader.vue'
</script>

<template>
  <div class="home">
    <HeroHeader />

    <nav class="menu">
      <router-link to="/basics" class="menu-card">
        <div class="menu-card-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
          </svg>
        </div>
        <div class="menu-card-text">
          <span class="menu-card-title">Basics</span>
          <span class="menu-card-sub">Lodging &amp; Transportation</span>
        </div>
        <svg class="menu-card-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </router-link>

      <router-link to="/itinerary" class="menu-card">
        <div class="menu-card-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
          </svg>
        </div>
        <div class="menu-card-text">
          <span class="menu-card-title">Itinerary</span>
          <span class="menu-card-sub">Day-by-day schedule</span>
        </div>
        <svg class="menu-card-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </router-link>
    </nav>
  </div>
</template>

<style scoped>
.home {
  min-height: 100vh;
  background: #fff9f2;
  font-family: system-ui, 'Segoe UI', sans-serif;
  display: flex;
  flex-direction: column;
}

/* ── Menu ── */
.menu {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 70px 24px 40px;
  max-width: 560px;
  width: 100%;
  margin: 0 auto;
  box-sizing: border-box;
}

.menu-card {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 24px 20px;
  background: #fff;
  border: 1px solid #C8D8D0;
  border-radius: 14px;
  text-decoration: none;
  color: #1A3329;
  box-shadow: 0 2px 10px rgba(0,0,0,0.06);
  transition: box-shadow 0.2s, border-color 0.2s, transform 0.15s;
}
.menu-card:hover {
  border-color: #C94030;
  box-shadow: 0 6px 20px rgba(46,99,82,0.15);
  transform: translateY(-2px);
}

.menu-card-icon {
  width: 48px;
  height: 48px;
  background: #E0EDEA;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #2E6352;
}
.menu-card-icon svg {
  width: 26px;
  height: 26px;
}

.menu-card-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.menu-card-title {
  font-size: 18px;
  font-weight: 600;
  color: #1A3329;
}
.menu-card-sub {
  font-size: 13px;
  color: #4E6B5F;
}

.menu-card-arrow {
  width: 20px;
  height: 20px;
  color: #C94030;
  flex-shrink: 0;
}
</style>
