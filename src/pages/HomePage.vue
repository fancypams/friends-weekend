<script setup>
import HeroHeader from '../components/HeroHeader.vue'

const tripCards = [
  { to: '/basics', title: 'Basics', sub: 'Lodging & Transportation', color: 'var(--deep-sky)' },
  { to: '/itinerary', title: 'Itinerary', sub: 'Day-by-day schedule', color: 'var(--steel-sky)' },
  { to: '/pre-trip', title: 'Pre-Trip Prep', sub: 'Movies, music & more', color: 'var(--green-primary)' },
  { to: '/groceries', title: 'Groceries', sub: 'Add to the shopping list', color: 'var(--terracotta)' },
]

const extrasCards = [
  { to: '/whales', title: 'Whale Sightings', sub: 'Puget Sound & Salish Sea', color: 'var(--deep-sky)', disabled: false },
  { to: null, title: 'Ghost Stories', sub: 'Haunted Seattle', color: 'var(--forest)', disabled: true },
]
</script>

<template>
  <div class="home">
    <HeroHeader />

    <main class="home-content">

      <!-- Welcome -->
      <section class="home-section welcome-section">
        <p class="section-label">Welcome</p>
        <h2 class="welcome-heading">We're going to Seattle!</h2>
        <p class="welcome-blurb">
          July 31st is almost here. The Airbnb is locked in, the itinerary is coming together, and there's a lot to look forward to. Use this site to keep up with trip details, add to the grocery list, and stay in the loop on everything leading up to the weekend.
        </p>
      </section>

      <!-- Trip Details -->
      <section class="home-section">
        <p class="section-label">Plan</p>
        <h2 class="section-heading">Trip Details</h2>
        <div class="card-grid four-col">
          <router-link
            v-for="card in tripCards"
            :key="card.to"
            :to="card.to"
            class="page-card"
            :style="{ '--card-accent': card.color }"
          >
            <span class="page-card-title">{{ card.title }}</span>
            <span class="page-card-sub">{{ card.sub }}</span>
          </router-link>
        </div>
      </section>

      <!-- Photos -->
      <section class="home-section photos-section">
        <p class="section-label">Gallery</p>
        <h2 class="section-heading">Trip Photos</h2>
        <p class="photos-blurb">Upload and browse photos from the trip. Everything stays private — just for us.</p>
        <router-link to="/photos" class="photos-cta">View Gallery</router-link>
      </section>

      <!-- Extras -->
      <section class="home-section">
        <p class="section-label">Extras</p>
        <h2 class="section-heading">More to Explore</h2>
        <div class="card-grid two-col">
          <component
            v-for="card in extrasCards"
            :key="card.title"
            :is="card.disabled ? 'div' : 'router-link'"
            :to="card.disabled ? undefined : card.to"
            class="page-card"
            :class="{ 'page-card--disabled': card.disabled }"
            :style="{ '--card-accent': card.color }"
          >
            <span class="page-card-title">{{ card.title }}</span>
            <span class="page-card-sub">{{ card.sub }}</span>
            <span v-if="card.disabled" class="coming-soon">Coming soon</span>
          </component>
        </div>
      </section>

    </main>
  </div>
</template>

<style scoped>
.home {
  min-height: 100vh;
  font-family: var(--font-sans);
  display: flex;
  flex-direction: column;
}

.home-content {
  max-width: var(--page-shell-max-width);
  margin: 0 auto;
  padding: 52px 24px 80px;
  display: flex;
  flex-direction: column;
  gap: 64px;
  width: 100%;
}

/* ── Section shared ── */
.section-label {
  font-family: var(--font-sign);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--sky-label);
  margin: 0 0 8px;
}

.section-heading {
  font-family: var(--font-display);
  font-size: clamp(22px, 4vw, 30px);
  color: var(--forest);
  margin: 0 0 24px;
  letter-spacing: -0.3px;
}

/* ── Welcome ── */
.welcome-section {
  max-width: 80%;
}

.welcome-heading {
  font-family: var(--font-display);
  font-size: clamp(26px, 5vw, 38px);
  color: var(--forest);
  margin: 0 0 16px;
  letter-spacing: -0.5px;
}

.welcome-blurb {
  font-family: var(--font-display);
  font-size: 17px;
  line-height: 1.75;
  color: var(--driftwood);
  margin: 0;
}

/* ── Cards ── */
.card-grid {
  display: grid;
  gap: 16px;
}

.four-col {
  grid-template-columns: repeat(4, 1fr);
}

.two-col {
  grid-template-columns: repeat(2, 1fr);
}

.page-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 20px 18px 24px;
  background: var(--bg-white);
  border-radius: 0 0 6px 6px;
  border-top: 4px solid var(--card-accent);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.07);
  text-decoration: none;
  transition: box-shadow 0.15s, transform 0.15s;
}

.page-card:not(.page-card--disabled):hover {
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
  transform: translateY(-2px);
}

.page-card--disabled {
  opacity: 0.45;
  cursor: default;
}

.page-card-title {
  font-family: var(--font-sign);
  font-size: 13px;
  font-weight: 700;
  color: var(--forest);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.page-card-sub {
  font-family: var(--font-playfair);
  font-size: 12px;
  font-style: italic;
  color: var(--driftwood);
}

.coming-soon {
  font-family: var(--font-sign);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--sky-label);
  margin-top: 6px;
}

/* ── Photos ── */
.photos-section {
  background: rgba(122, 176, 180, 0.1);
  border: 1px solid rgba(92, 138, 150, 0.2);
  border-radius: 12px;
  padding: 40px 36px;
}

.photos-blurb {
  font-family: var(--font-playfair);
  font-size: 15px;
  line-height: 1.65;
  color: var(--driftwood);
  margin: 0 0 24px;
  max-width: 460px;
}

.photos-cta {
  display: inline-block;
  font-family: var(--font-sign);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--bg-white);
  background: var(--steel-sky);
  padding: 10px 22px;
  border-radius: 4px;
  text-decoration: none;
  transition: background 0.15s;
}

.photos-cta:hover {
  background: var(--deep-sky);
}

/* ── Responsive ── */
@media (max-width: 768px) {
  .welcome-section {
   max-width: 100%;
  }
  .four-col {
    grid-template-columns: repeat(2, 1fr);
  }

  .photos-section {
    padding: 28px 24px;
  }

  .home-content {
    gap: 48px;
    padding: 40px 20px 64px;
  }
}

@media (max-width: 480px) {
  .two-col {
    grid-template-columns: 1fr;
  }

  .home-content {
    gap: 40px;
    padding: 32px 16px 64px;
  }
}
</style>
