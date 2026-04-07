<script setup>
import HeroHeader from '../components/HeroHeader.vue'
</script>

<template>
  <div class="home">
    <HeroHeader />

    <nav class="menu">
      <router-link to="/basics" class="pennant-card" style="--card-bg: var(--deep-sky)">
        <span class="pennant-num">01</span>
        <div class="pennant-text">
          <span class="pennant-title">Basics</span>
          <span class="pennant-sub">Lodging &amp; Transportation</span>
        </div>
        <span class="pennant-arrow">›</span>
      </router-link>

      <router-link to="/itinerary" class="pennant-card" style="--card-bg: var(--steel-sky)">
        <span class="pennant-num">02</span>
        <div class="pennant-text">
          <span class="pennant-title">Itinerary</span>
          <span class="pennant-sub">Day-by-day schedule</span>
        </div>
        <span class="pennant-arrow">›</span>
      </router-link>

      <router-link to="/photos" class="menu-card">
        <div class="menu-card-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M3.75 6.75A2.25 2.25 0 016 4.5h12a2.25 2.25 0 012.25 2.25v10.5A2.25 2.25 0 0118 19.5H6a2.25 2.25 0 01-2.25-2.25V6.75z" />
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M8.25 10.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm-2.25 6l3.75-3.75a1.5 1.5 0 012.121 0l.879.879a1.5 1.5 0 002.121 0L18 10.5" />
          </svg>
        </div>
        <div class="menu-card-text">
          <span class="menu-card-title">Photos</span>
          <span class="menu-card-sub">Shared private gallery</span>
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
  background: var(--bg-page);
  font-family: var(--font-sans);
  display: flex;
  flex-direction: column;
}

/* ── Menu ── */
.menu {
  display: flex;
  flex-direction: column;
  margin-top: 32px;
}

.pennant-card {
  display: flex;
  align-items: center;
  padding: 0 90px;
  height: 100px;
  background: var(--card-bg);
  text-decoration: none;
  position: relative;
  overflow: hidden;
  transition: filter 0.15s;
}
.pennant-card:hover {
  filter: brightness(1.08);
}

.pennant-num {
  font-family: var(--font-playfair);
  font-size: 80px;
  font-style: italic;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.18);
  line-height: 1;
  width: 90px;
  flex-shrink: 0;
  margin-right: 24px;
  user-select: none;
  padding-bottom: 20px;
}

.pennant-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.pennant-title {
  font-family: var(--font-sign);
  font-size: 22px;
  font-weight: 700;
  color: #fff;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.pennant-sub {
  font-family: var(--font-playfair);
  font-size: 14px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.65);
  letter-spacing: 2.5px;
}

.pennant-arrow {
  font-size: 22px;
  color: rgba(255, 255, 255, 0.45);
  flex-shrink: 0;
  font-family: var(--font-sans);
}
@media (max-width: 768px) {
  .pennant-card {
    padding: 0 16px;
  }
}
</style>
