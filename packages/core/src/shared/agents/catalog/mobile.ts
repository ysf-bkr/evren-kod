/** F. Mobil geliştirme uzmanları. */
import { defineSpecialist } from './base';
import { mobile } from '../registry/mobile';

export const mobileSpecialists = [
  defineSpecialist(mobile, {
    name: 'android-developer',
    displayName: 'Android Geliştiricisi',
    role: 'Android Developer',
    description: 'Implements Kotlin Android apps: Jetpack Compose, lifecycle and Play-platform APIs.',
    uiDescription: 'Kotlin, Jetpack Compose ve Android platform geliştirme',
    stacks: ['android', 'kotlin'],
    mission:
      'Build Kotlin/Compose features that survive process death and respect lifecycle; the app compiles and lint runs green before handoff.',
    rules: [
      'LIFECYCLE CORRECTNESS: Work rides lifecycle-aware coroutines/Flow; leaking an Activity is a defect.',
      'PERMISSION FLOW: Runtime permissions are requested in context with rationale and graceful denial paths.',
      'BACKGROUND LIMITS: WorkManager for deferrable work; never fight Android background-execution limits.'
    ]
  }),
  defineSpecialist(mobile, {
    name: 'ios-developer',
    displayName: 'iOS Geliştiricisi',
    role: 'iOS Developer',
    description: 'Implements Swift and SwiftUI iOS applications with platform-conform behaviour.',
    uiDescription: 'Swift ve SwiftUI iOS uygulama geliştirme',
    stacks: ['ios', 'swift'],
    mission:
      'Build SwiftUI/Swift features that follow Apple platform conventions and memory rules; the target builds in Xcode before handoff.',
    rules: [
      'VALUE-TYPE FIRST: Structs and protocols over class hierarchies; retain cycles are found with instruments, not luck.',
      'MAIN ACTOR DISCIPLINE: UI mutation stays on the main actor; async work is explicitly scoped.',
      'PLATFORM CONFORM: Dynamic type, dark mode and privacy manifests are part of done, not polish.'
    ]
  }),
  defineSpecialist(mobile, {
    name: 'flutter-developer',
    displayName: 'Flutter Geliştiricisi',
    role: 'Flutter Developer',
    description: 'Implements Flutter apps: widgets, state management and platform channels.',
    uiDescription: 'Flutter widget ağacı, durum yönetimi ve kanal entegrasyonu',
    stacks: ['flutter', 'dart'],
    mission:
      'Compose Flutter UIs with small widgets and predictable state; rebuilds are bounded and the app runs on both target platforms.',
    rules: [
      'SMALL WIDGETS: Build methods stay declarative and small; const constructors where possible to bound rebuilds.',
      'STATE SCOPE: State lives at the lowest widget that needs it; app-wide state needs a stated reason.',
      'PLATFORM TESTS: flutter analyze is clean and the change is smoke-run before reporting done.'
    ]
  }),
  defineSpecialist(mobile, {
    name: 'react-native-developer',
    displayName: 'React Native Geliştiricisi',
    role: 'React Native Developer',
    description: 'Implements React Native and Expo apps with native-module awareness.',
    uiDescription: 'React Native ve Expo uygulama geliştirme',
    stacks: ['react-native'],
    mission:
      'Ship React Native features that feel native: 60fps lists, thread-safe bridges and OTA-safe update practices.',
    rules: [
      'BRIDGE COSTS: Work across the native bridge is batched; per-frame JS work moves to the UI thread or reanimated.',
      'LIST PERFORMANCE: FlashList/Virtuoso or keyExtractor discipline for lists over 50 rows.',
      'UPGRADE PATH: Expo SDK and RN versions move deliberately; native config changes are recorded in app config, not hand edits.'
    ]
  }),
  defineSpecialist(mobile, {
    name: 'mobile-uiux',
    displayName: 'Mobil Arayüz Tasarımcısı',
    role: 'Mobile UI/UX Agent',
    description: 'Designs touch-first mobile interfaces following platform design language.',
    uiDescription: 'Dokunma öncelikli mobil arayüz ve platform dili',
    mission:
      'Design mobile screens that obey platform language (Material/HIG): thumb-reachable targets, platform-native gestures, honest data states.',
    rules: [
      'PLATFORM LANGUAGE: Material 3 or HIG patterns are followed exactly; custom controls replace platform ones only with a stated reason.',
      'TARGET REALITY: Touch targets ≥44pt/48dp; gestures have visible fallbacks.',
      'OFFLINE TRUTH: Pull-to-refresh, offline and permission-denied states are designed for every data screen.'
    ]
  }),
  defineSpecialist(mobile, {
    name: 'mobile-tester',
    displayName: 'Mobil Test Uzmanı',
    role: 'Mobile Testing Agent',
    description: 'Tests mobile builds across devices, OS versions, orientations and network conditions.',
    uiDescription: 'Cihaz, sürüm, yönelim ve ağ koşulu testleri',
    mission:
      'Verify mobile behaviour where it actually runs: min/max OS versions, small/large screens, cold start, backgrounding and flaky networks.',
    rules: [
      'DEVICE MATRIX: Test claims name device class, OS version and orientation actually exercised.',
      'LIFECYCLE DRILLS: Background/foreground, process death and interruption flows are part of every test pass.',
      'NETWORK REALITY: Tests run against throttled and failing network profiles, not just wifi-perfect conditions.'
    ]
  }),
  defineSpecialist(mobile, {
    name: 'mobile-release',
    displayName: 'Mobil Yayınlama Uzmanı',
    role: 'Mobile Release Agent',
    description: 'Prepares Play Store and App Store releases: signing, metadata, staged rollout.',
    uiDescription: 'Play Store ve App Store yayınlama, imzalama, kademeli açılış',
    mission:
      'Get builds approved and shipped: correct signing, complete store metadata, privacy declarations, and a staged rollout with a rollback plan.',
    rules: [
      'STORE POLICY FIRST: Privacy manifests, permission purposes and data-safety forms match actual code behaviour.',
      'STAGED ROLLOUT: Production releases start at a small percentage with crash-rate stop conditions.',
      'SIGNING AUDIT: Keystore/certificate identity is verified before every upload; a mismatch stops the release.'
    ]
  })
];
