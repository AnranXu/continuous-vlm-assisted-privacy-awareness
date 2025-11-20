// src/store.js
import { create } from 'zustand';

export const useStore = create((set) => ({
  participantId: '',
  assignedMode: null,       // "human" | "vlm"
  storyId: 'story_01',
  totalClips: 0,
  currentClipIndex: 1,
  videoUrl: null,
  vlmDetections: null,      // JSON from VLM
  assignment: null,         // assignment/progress JSON
  storyConfig: null,        // config.json contents
  storyAnalysis: null,      // story_01.json contents
  prolificCompletionUrl: null,
  setState: (next) => set(next),
}));
