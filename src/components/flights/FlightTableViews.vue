<script setup>
import { computed, ref } from 'vue'
import {
  buildMobileFlightJourneys,
  flightGroupKey,
  flightOperationalDetails,
  getRoute,
  isArriving,
  journeyRoute,
  journeyStatus,
  journeyStatusTone,
  journeyTripLegLabel,
  liveStatusDetail,
  liveStatusLabel,
  liveStatusTone,
  tripLegLabel,
} from '../../lib/flightDisplay'

const props = defineProps({
  flights: {
    type: Array,
    required: true,
  },
})

const expandedJourneyKeys = ref(new Set())
const mobileFlightJourneys = computed(() => buildMobileFlightJourneys(props.flights))

function isJourneyExpanded(key) {
  return expandedJourneyKeys.value.has(key)
}

function toggleJourneyDetails(key) {
  const next = new Set(expandedJourneyKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedJourneyKeys.value = next
}
</script>

<template>
  <div class="table-wrap table-wrap--desktop">
    <table class="flights-table">
      <thead>
        <tr>
          <th>Person</th>
          <th>Trip leg</th>
          <th>Route</th>
          <th>Flight</th>
          <th>Date</th>
          <th>Time</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="f in flights" :key="flightGroupKey(f)">
          <td>
            <span class="table-family">{{ f.family }}</span>
            <span class="table-travelers">{{ f.travelerDisplay }}</span>
          </td>
          <td>
            <span class="table-trip-leg" :class="isArriving(f) ? 'table-trip-leg--arriving' : 'table-trip-leg--departing'">
              {{ tripLegLabel(f) }}
            </span>
          </td>
          <td class="route-cell">{{ getRoute(f) }}</td>
          <td>{{ f.flightNumber }}</td>
          <td>{{ f.date }}</td>
          <td class="time-cell">{{ f.departureTime }} → {{ f.arrivalTime }}</td>
          <td class="status-cell">
            <span class="status-chip" :class="liveStatusTone(f.liveStatus)">
              {{ liveStatusLabel(f) }}
            </span>
            <span v-if="liveStatusDetail(f.liveStatus, f)" class="status-detail">
              {{ liveStatusDetail(f.liveStatus, f) }}
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="mobile-journeys" aria-label="Flight journeys">
    <article
      v-for="journey in mobileFlightJourneys"
      :key="journey.key"
      class="mobile-journey-card"
      :class="isArriving(journey.flights[0]) ? 'mobile-journey-card--arriving' : 'mobile-journey-card--departing'"
    >
      <div class="mobile-journey-top">
        <div>
          <div class="mobile-family">{{ journey.family }}</div>
          <div class="mobile-travelers">{{ journey.travelerDisplay }}</div>
        </div>
        <span class="status-chip" :class="journeyStatusTone(journey)">
          {{ journeyStatus(journey) }}
        </span>
      </div>

      <div class="mobile-route">{{ journeyRoute(journey) }}</div>

      <div class="mobile-trip-leg" :class="isArriving(journey.flights[0]) ? 'mobile-trip-leg--arriving' : 'mobile-trip-leg--departing'">
        <span class="mobile-field-label">Trip leg</span>
        <span>{{ journeyTripLegLabel(journey) }}</span>
      </div>

      <div class="mobile-leg-list">
        <div v-for="flight in journey.flights" :key="flightGroupKey(flight)" class="mobile-leg">
          <div class="mobile-leg-main">
            <span class="mobile-flight-number">{{ flight.flightNumber }}</span>
            <span>{{ getRoute(flight) }}</span>
          </div>
          <div class="mobile-leg-meta">
            <span>{{ flight.date }}</span>
            <span class="meta-sep">·</span>
            <span>{{ flight.departureTime }} → {{ flight.arrivalTime }}</span>
          </div>
          <div class="mobile-leg-status">
            <span class="status-chip" :class="liveStatusTone(flight.liveStatus)">
              {{ liveStatusLabel(flight) }}
            </span>
            <span v-if="liveStatusDetail(flight.liveStatus, flight)" class="mobile-status-detail">
              {{ liveStatusDetail(flight.liveStatus, flight) }}
            </span>
          </div>
        </div>
      </div>

      <button
        type="button"
        class="mobile-details-toggle"
        :aria-expanded="isJourneyExpanded(journey.key)"
        @click="toggleJourneyDetails(journey.key)"
      >
        {{ isJourneyExpanded(journey.key) ? 'Hide details' : 'Details' }}
      </button>

      <div v-if="isJourneyExpanded(journey.key)" class="mobile-details">
        <div v-for="flight in journey.flights" :key="`${flightGroupKey(flight)}-details`" class="mobile-detail-leg">
          <div class="mobile-detail-title">{{ flight.flightNumber }} · {{ getRoute(flight) }}</div>
          <div v-if="flightOperationalDetails(flight).length" class="mobile-detail-list">
            <span v-for="detail in flightOperationalDetails(flight)" :key="detail">{{ detail }}</span>
          </div>
          <div v-else class="mobile-detail-empty">No gate or terminal details yet.</div>
        </div>
      </div>
    </article>
  </div>
</template>

<style scoped>
.table-wrap {
  overflow-x: auto;
  border-radius: 6px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.07);
}

.flights-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--font-sans);
  font-size: 14px;
  background: var(--bg-white, white);
}

.flights-table th {
  font-family: var(--font-sign);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--sky-label);
  padding: 12px 16px;
  text-align: left;
  border-bottom: 2px solid var(--parchment, #e8e0d4);
  white-space: nowrap;
}

.flights-table td {
  padding: 13px 16px;
  border-bottom: 1px solid var(--parchment, #e8e0d4);
  color: var(--forest);
  vertical-align: middle;
}

.table-family,
.table-travelers {
  display: block;
}

.table-family {
  font-family: var(--font-sign);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.table-travelers {
  margin-top: 2px;
  font-size: 12px;
  color: var(--driftwood);
}

.flights-table tbody tr:last-child td {
  border-bottom: none;
}

.flights-table tbody tr:hover td {
  background: rgba(0, 0, 0, 0.015);
}

.route-cell {
  font-family: var(--font-display);
  font-size: 15px;
  white-space: nowrap;
}

.table-trip-leg {
  display: inline-block;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.table-trip-leg--arriving {
  color: #3d7d4a;
}

.table-trip-leg--departing {
  color: #a0513f;
}

.time-cell {
  white-space: nowrap;
  color: var(--driftwood);
}

.status-cell {
  min-width: 150px;
}

.status-chip {
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  font-family: var(--font-sign);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  line-height: 1.1;
  padding: 3px 8px;
  text-transform: uppercase;
  white-space: nowrap;
}

.status-chip--ok {
  background: rgba(93, 171, 108, 0.14);
  color: #3d7d4a;
}

.status-chip--warning {
  background: rgba(198, 152, 50, 0.16);
  color: #8b6420;
}

.status-chip--critical {
  background: rgba(178, 73, 58, 0.14);
  color: #a23d31;
}

.status-chip--muted {
  background: rgba(116, 105, 86, 0.12);
  color: var(--driftwood);
}

.status-detail {
  display: block;
  margin-top: 4px;
  color: var(--driftwood);
  font-size: 12px;
  white-space: nowrap;
}

.mobile-journeys {
  display: none;
}

.mobile-journey-card {
  background: var(--bg-white, white);
  border-radius: 6px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.07);
  overflow: hidden;
  padding: 14px 14px 12px;
  position: relative;
}

.mobile-journey-card::before {
  bottom: 0;
  content: '';
  left: 0;
  position: absolute;
  top: 0;
  width: 4px;
}

.mobile-journey-card--arriving::before {
  background: var(--green-primary);
}

.mobile-journey-card--departing::before {
  background: var(--terracotta);
}

.mobile-journey-top {
  align-items: flex-start;
  display: flex;
  gap: 10px;
  justify-content: space-between;
}

.mobile-family {
  color: var(--forest);
  font-family: var(--font-sign);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.mobile-travelers {
  color: var(--driftwood);
  font-size: 12px;
  margin-top: 2px;
}

.mobile-route {
  color: var(--forest);
  font-family: var(--font-display);
  font-size: 22px;
  line-height: 1.12;
  margin-top: 13px;
  overflow-wrap: anywhere;
}

.mobile-trip-leg {
  align-items: center;
  display: flex;
  gap: 7px;
  font-size: 12px;
  font-weight: 700;
  margin-top: 9px;
}

.mobile-trip-leg--arriving {
  color: #3d7d4a;
}

.mobile-trip-leg--departing {
  color: #a0513f;
}

.mobile-field-label {
  color: var(--driftwood);
  font-family: var(--font-sign);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.mobile-leg-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 14px;
}

.mobile-leg {
  border-top: 1px solid var(--parchment, #e8e0d4);
  padding-top: 10px;
}

.mobile-leg-main {
  align-items: baseline;
  color: var(--forest);
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 700;
}

.mobile-flight-number {
  font-family: var(--font-sign);
  letter-spacing: 0.06em;
}

.mobile-leg-meta {
  align-items: center;
  color: var(--driftwood);
  display: flex;
  flex-wrap: wrap;
  font-size: 12px;
  gap: 5px;
  margin-top: 3px;
}

.mobile-leg-status {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 8px;
}

.mobile-status-detail {
  color: var(--driftwood);
  font-size: 12px;
}

.mobile-details-toggle {
  align-items: center;
  background: transparent;
  border: 1px solid rgba(38, 48, 39, 0.18);
  border-radius: 4px;
  color: var(--forest);
  cursor: pointer;
  display: flex;
  font-family: var(--font-sign);
  font-size: 10px;
  font-weight: 700;
  justify-content: center;
  letter-spacing: 0.08em;
  margin-top: 13px;
  min-height: 38px;
  padding: 8px 10px;
  text-transform: uppercase;
  width: 100%;
}

.mobile-details {
  background: rgba(232, 224, 212, 0.28);
  border-radius: 5px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
  padding: 10px;
}

.mobile-detail-title {
  color: var(--forest);
  font-family: var(--font-sign);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.mobile-detail-list {
  color: var(--driftwood);
  display: flex;
  flex-direction: column;
  font-size: 12px;
  gap: 3px;
  margin-top: 5px;
}

.mobile-detail-empty {
  color: var(--driftwood);
  font-size: 12px;
  margin-top: 5px;
}

@media (max-width: 600px) {
  .table-wrap--desktop {
    display: none;
  }

  .mobile-journeys {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
}
</style>
