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

            <router-link to="/photos" class="pennant-card" style="--card-bg: var(--green-primary)">
        <span class="pennant-num">03</span>
        <div class="pennant-text">
          <span class="pennant-title">Photos</span>
          <span class="pennant-sub">Shared private gallery</span>
        </div>
        <span class="pennant-arrow">›</span>
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
