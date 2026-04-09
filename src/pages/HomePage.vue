<script setup>
import HeroHeader from '../components/HeroHeader.vue'
</script>

<template>
  <div class="home">
    <HeroHeader />

    <nav class="menu">
      <router-link to="/basics" class="pennant-card" style="--card-bg: var(--deep-sky)">

        <div class="pennant-text">
          <span class="pennant-title">Basics</span>
          <span class="pennant-sub">Lodging &amp; Transportation</span>
        </div>

      </router-link>

      <router-link to="/itinerary" class="pennant-card" style="--card-bg: var(--steel-sky)">
        <div class="pennant-text">
          <span class="pennant-title">Itinerary</span>
          <span class="pennant-sub">Day-by-day schedule</span>
        </div>

      </router-link>

      <router-link to="/pre-trip" class="pennant-card" style="--card-bg: var(--green-primary)">
        <div class="pennant-text">
          <span class="pennant-title">Pre-Trip Prep</span>
          <span class="pennant-sub">Movies, music &amp; more</span>
        </div>
      </router-link>

      <router-link to="/groceries" class="pennant-card" style="--card-bg: var(--terracotta)">
        <div class="pennant-text">
          <span class="pennant-title">Groceries</span>
          <span class="pennant-sub">Add to the shopping list</span>
        </div>
      </router-link>

      <router-link to="/photos" class="pennant-card" style="--card-bg: var(--gold)">
        <div class="pennant-text">
          <span class="pennant-title">Photos</span>
          <span class="pennant-sub">Shared private gallery</span>
        </div>
      </router-link>

      <router-link to="/whales" class="pennant-card" style="--card-bg: var(--deep-sky)">
        <div class="pennant-text">
          <span class="pennant-title">Whale Sightings</span>
          <span class="pennant-sub">Puget Sound &amp; Salish Sea</span>
        </div>
      </router-link>
    </nav>
  </div>
</template>

<style scoped>
.home {
  min-height: 100vh;
  background: transparent;
  font-family: var(--font-sans);
  display: flex;
  flex-direction: column;
}

/* ── Menu ── */
.menu {
  display: grid;
  grid-template-columns: repeat(1, 1fr);
  gap: 20px;
  width: 100%;
  max-width: 1080px;
  margin: 40px auto;
  padding: 0 24px 64px;
}

.pennant-card {
  display: flex;
  flex-direction: column;
  padding: 24px 20px 28px;
  background: var(--bg-white);
  border-radius: 0 0 6px 6px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.07);
  border-top: 4px solid var(--card-bg);
  text-decoration: none;
  transition: box-shadow 0.15s, transform 0.15s;
}
.pennant-card:hover {
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
  transform: translateY(-2px);
}


.pennant-text {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pennant-title {
  font-family: var(--font-sign);
  font-size: 16px;
  font-weight: 700;
  color: var(--forest);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.pennant-sub {
  font-family: var(--font-playfair);
  font-size: 13px;
  font-style: italic;
  color: var(--driftwood);
}

@media (max-width: 600px) {
  .menu {
    grid-template-columns: 1fr;
    gap: 16px;
  }
  .pennant-card {
    flex-direction: row;
    align-items: center;
    padding: 16px 20px;
    gap: 16px;
  }
  .pennant-num {
    margin-bottom: 0;
    font-size: 28px;
  }
}
</style>
