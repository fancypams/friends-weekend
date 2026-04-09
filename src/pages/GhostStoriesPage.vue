<script setup>
import { ref, computed } from 'vue'
import HeroHeader from '../components/HeroHeader.vue'
import stories from '../data/ghost-stories.json'

const search = ref('')
const expandedId = ref(null)

const neighborhoodColors = {
  'Downtown':         'var(--deep-sky)',
  'Belltown':         'var(--terracotta)',
  'First Hill':       'var(--gold)',
  'Capitol Hill':     'var(--steel-sky)',
  'Pioneer Square':   'var(--sage)',
  'Georgetown':       'var(--honey)',
  'Pike Place Market':'var(--red-error)',
}

function borderColor(neighborhood) {
  return neighborhoodColors[neighborhood] ?? 'var(--deep-sky)'
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return stories
  return stories.filter(
    (s) =>
      s.location.toLowerCase().includes(q) ||
      s.neighborhood.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q),
  )
})

const leftCol = computed(() => filtered.value.filter((_, i) => i % 2 === 0))
const rightCol = computed(() => filtered.value.filter((_, i) => i % 2 === 1))

function toggle(id) {
  expandedId.value = expandedId.value === id ? null : id
}
</script>

<template>
  <div class="page-wrap">
    <HeroHeader :show-back="true" />

    <main class="page-main">
      <header class="page-header">
        <p class="page-label">Seattle</p>
        <h1 class="page-title">Ghost Stories</h1>
        <p class="page-subtitle">
          Seattle is one of the most haunted cities in the Pacific Northwest. These are the stories locals tell after dark.
        </p>
      </header>

      <div class="controls">
        <input
          v-model="search"
          type="search"
          placeholder="Search locations or neighborhoods…"
          class="search-input"
          aria-label="Search ghost stories"
        />
        <p class="result-count">{{ filtered.length }} {{ filtered.length === 1 ? 'location' : 'locations' }}</p>
      </div>

      <div v-if="filtered.length" class="story-grid">
        <div v-for="col in [leftCol, rightCol]" :key="col === leftCol ? 'left' : 'right'" class="story-col">
          <article
            v-for="story in col"
            :key="story.id"
            class="story-card"
            :class="{ 'is-expanded': expandedId === story.id }"
            :style="{ '--border-color': borderColor(story.neighborhood) }"
            :aria-expanded="expandedId === story.id"
            @click="toggle(story.id)"
          >
            <div class="story-header">
              <div class="story-header-text">
                <h2 class="story-location">{{ story.location }}</h2>
                <span class="story-neighborhood">{{ story.neighborhood }}</span>
              </div>
              <svg
                class="toggle-chevron"
                :class="{ open: expandedId === story.id }"
                width="14" height="14" viewBox="0 0 14 14" fill="none"
                aria-hidden="true"
              >
                <path d="M3 5l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>

            <p class="story-description">{{ story.description }}</p>

            <Transition name="expand">
              <div v-if="expandedId === story.id" class="story-full">
                <p
                  v-for="(para, pi) in story.story.split('\n\n')"
                  :key="pi"
                  class="story-para"
                >{{ para }}</p>
              </div>
            </Transition>
          </article>
        </div>
      </div>

      <div v-else class="empty-state">
        <p>No locations found for "{{ search }}".</p>
      </div>
    </main>
  </div>
</template>

<style scoped>
.page-wrap {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* ── Page header ── */
.page-header {
  margin-bottom: 36px;
}

.page-label {
  font-family: var(--font-sign);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--sky-label);
  margin: 0 0 8px;
}

.page-title {
  font-family: var(--font-display);
  font-size: clamp(28px, 6vw, 48px);
  color: var(--forest);
  margin: 0 0 12px;
  letter-spacing: -0.5px;
}

.page-subtitle {
  font-family: var(--font-display);
  font-size: 20px;
  font-style: italic;
  line-height: 1.65;
  color: var(--driftwood);
  margin: 0;
  max-width: 80%;
}

/* ── Controls ── */
.controls {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 32px;
  flex-wrap: wrap;
}

.search-input {
  flex: 1;
  min-width: 220px;
  max-width: 400px;
  padding: 10px 14px;
  font-family: var(--font-sans);
  font-size: 14px;
  color: var(--forest);
  background: var(--bg-white);
  border: 1px solid rgba(92, 138, 150, 0.35);
  border-radius: 6px;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.search-input:focus {
  border-color: var(--steel-sky);
  box-shadow: 0 0 0 3px rgba(92, 138, 150, 0.15);
}

.result-count {
  font-family: var(--font-sign);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--sky-label);
  margin: 0;
  white-space: nowrap;
}

/* ── Story grid ── */
.story-grid {
  display: flex;
  gap: 20px;
  align-items: flex-start;
}

.story-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.story-card {
  background: var(--bg-white);
  border-radius: 0 6px 6px 0;
  border-left: 4px solid var(--border-color, var(--forest));
  padding: 22px 22px 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.07);
  display: flex;
  flex-direction: column;
  transition: box-shadow 0.15s;
  cursor: pointer;
  user-select: none;
}

.story-card.is-expanded {
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.11);
}

/* ── Card header ── */
.story-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.story-header-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.story-location {
  font-family: var(--font-sign);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--forest);
  margin: 0;
}

.story-neighborhood {
  font-family: var(--font-sign);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--sky-label);
}

/* ── Description teaser ── */
.story-description {
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.7;
  color: var(--driftwood);
  margin: 0 0 16px;
}

/* ── Full story ── */
.story-full {
  border-top: 1px solid rgba(92, 138, 150, 0.18);
  padding-top: 16px;
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.story-para {
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.8;
  color: var(--forest);
  margin: 0;
}

/* ── Expand transition ── */
.expand-enter-active,
.expand-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

/* ── Chevron ── */
.toggle-chevron {
  color: var(--sky-label);
  transition: transform 0.25s ease;
  flex-shrink: 0;
  margin-top: 2px;
}

.toggle-chevron.open {
  transform: rotate(180deg);
}

.story-card:hover .toggle-chevron {
  color: var(--terracotta);
}

/* ── Empty ── */
.empty-state {
  font-family: var(--font-playfair);
  font-size: 15px;
  font-style: italic;
  color: var(--driftwood);
  text-align: center;
  padding: 60px 0;
}

/* ── Responsive ── */
@media (max-width: 640px) {
  .story-grid {
    flex-direction: column;
  }

  .controls {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  .search-input {
    max-width: 100%;
    width: 100%;
  }

  .page-subtitle {
    max-width: 100%;
  }
}
</style>
