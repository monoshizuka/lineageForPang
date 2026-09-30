<script setup>
import { ref } from "vue";
import LineageDetailPage from "./pages/LineageDetailPage.vue";
import LineageListPage from "./pages/LineageListPage.vue";

const selectedLineage = ref(null);

function openLineage(lineage) {
  selectedLineage.value = lineage;
}

function updateLineage(lineage) {
  selectedLineage.value = lineage;
}

function closeDetail() {
  selectedLineage.value = null;
}
</script>

<template>
  <LineageListPage v-if="!selectedLineage" @open="openLineage" />
  <LineageDetailPage
    v-else
    :lineage="selectedLineage"
    @back="closeDetail"
    @updated="updateLineage"
  />
</template>
