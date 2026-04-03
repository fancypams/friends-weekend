import { createRouter, createWebHashHistory } from 'vue-router'
import HomePage from '../pages/HomePage.vue'
import BasicsPage from '../pages/BasicsPage.vue'
import ItineraryPage from '../components/Itinerary.vue'

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: HomePage },
    { path: '/basics', component: BasicsPage },
    { path: '/itinerary', component: ItineraryPage },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
