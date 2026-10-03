export const en = {
  "guidance.registered.title": "Package registered for the checked signing key",
  "guidance.registered.apk.summary": "The checked signing key is registered for {package}.",
  "guidance.registered.fdroid.summary":
    "The checked signing key is registered for {package}; for an F-Droid APK, confirm that the distributed build uses the same registered key.",
  "guidance.registered.apk.step.verify":
    "Compare {fingerprint} with the certificate fingerprint used by this build.",
  "guidance.registered.fdroid.step.verify":
    "Compare {fingerprint} with the certificate fingerprint of the F-Droid build you checked.",
  "guidance.registered.step.verifyWithoutFingerprint":
    "Confirm which certificate fingerprint was checked for this package.",
  "guidance.registered.fdroid.step.track":
    "If F-Droid signs the distributed APK with its own key, register that signing key for the package as well.",
  "guidance.registered.step.status":
    "Re-check the package and certificate pair when the signing key changes.",
  "guidance.registered.step.docs":
    "Use the Android developer verification guides to review package and key registration details.",

  "guidance.registered_other_key.title": "Package registered with another signing key",
  "guidance.registered_other_key.apk.summary":
    "The package {package} is registered, but not for the signing key checked in this build.",
  "guidance.registered_other_key.fdroid.summary":
    "The package {package} is registered, but not for the signing key checked in this F-Droid build.",
  "guidance.registered_other_key.step.fingerprint":
    "Compare the checked certificate fingerprint {fingerprint} with the signing keys registered for {package}.",
  "guidance.registered_other_key.step.identify":
    "Confirm which developer and which distribution channel use each registered signing key; the package may be associated with a different developer.",
  "guidance.registered_other_key.step.add":
    "If this signing key should be covered, follow the official registration guidance to add and verify the key.",

  "guidance.not_registered.title": "Package not registered for the checked signing key",
  "guidance.not_registered.apk.summary":
    "The signing key checked for {package} is not registered for that package.",
  "guidance.not_registered.fdroid.summary":
    "The F-Droid APK for {package} is not registered for the signing key checked.",
  "guidance.not_registered.apk.step.register":
    "Register {package} with the signing key used by this build.",
  "guidance.not_registered.fdroid.step.register":
    "Confirm the certificate used by the distributed F-Droid APK, then register that signing key for {package} when appropriate.",
  "guidance.not_registered.fdroid.step.repro":
    "Where practical, work toward a reproducible distribution build so the published APK can carry the developer's own signing key.",
  "guidance.not_registered.step.check":
    "Re-run the registration status check after the package and signing key are updated.",

  "guidance.unknown.title": "Registration status could not be determined",
  "guidance.unknown.apk.summary":
    "The registration state for {package} could not be determined for the checked signing key.",
  "guidance.unknown.fdroid.summary":
    "The registration state for the checked F-Droid build of {package} could not be determined.",
  "guidance.unknown.step.check":
    "Retry the status check and confirm the package name and certificate fingerprint are correct.",
  "guidance.unknown.step.inspect":
    "Inspect the signing certificate from the exact APK build you intend to distribute.",
  "guidance.unknown.step.docs":
    "Review the official Android developer verification documentation for current registration requirements.",

  "guidance.link.overview.label": "Android developer verification overview",
  "guidance.link.overview.url": "https://developer.android.com/developer-verification",
  "guidance.link.registration.label": "Open-source app registration guide",
  "guidance.link.registration.url":
    "https://developer.android.com/developer-verification/guides/open-source-app-registration",
  "guidance.link.status.label": "Check registration status",
  "guidance.link.status.url":
    "https://developer.android.com/developer-verification/guides/check-registration-status",
  "guidance.link.limited.label": "Limited distribution guide",
  "guidance.link.limited.url":
    "https://developer.android.com/developer-verification/guides/limited-distribution",
  "guidance.link.full.label": "Full distribution guide",
  "guidance.link.full.url":
    "https://developer.android.com/developer-verification/guides/full-distribution",
  "guidance.link.faq.label": "Android developer verification FAQ",
  "guidance.link.faq.url": "https://developer.android.com/developer-verification/guides/faq",
} as const;

export type GuidanceKey = keyof typeof en;
