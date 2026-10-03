import type { AppStatus } from '../status/types.js';
import { en, type GuidanceKey } from './en.js';

export type GuidanceOrigin = 'fdroid' | 'apk';

export interface GuidanceContext {
  readonly package: string;
  readonly fingerprint?: string;
  readonly origin: GuidanceOrigin;
}

export interface GuidanceLink {
  readonly label: string;
  readonly url: string;
}

export interface Guidance {
  readonly title: string;
  readonly summary: string;
  readonly steps: string[];
  readonly links: GuidanceLink[];
}

export type GuidanceParams = Record<string, string | number>;

export function t(key: GuidanceKey, params: GuidanceParams = {}): string {
  return en[key].replace(/{([^}]+)}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

function paramsFor(ctx: GuidanceContext): GuidanceParams {
  return {
    package: ctx.package,
    ...(ctx.fingerprint === undefined ? {} : { fingerprint: ctx.fingerprint }),
  };
}

function link(key: string): GuidanceLink {
  const label = en[`guidance.link.${key}.label` as GuidanceKey];
  const url = en[`guidance.link.${key}.url` as GuidanceKey];
  return { label, url };
}

function linksFor(status: AppStatus): GuidanceLink[] {
  switch (status) {
    case 'registered':
      return [link('status'), link('overview')];
    case 'registered_other_key':
      return [link('status'), link('registration'), link('faq')];
    case 'not_registered':
      return [link('status'), link('registration'), link('limited'), link('full')];
    case 'unknown':
      return [link('status'), link('overview'), link('faq')];
  }
}

function contentKeys(
  status: AppStatus,
  origin: GuidanceOrigin,
  hasFingerprint: boolean,
): {
  readonly title: GuidanceKey;
  readonly summary: GuidanceKey;
  readonly steps: readonly GuidanceKey[];
} {
  switch (status) {
    case 'registered':
      return {
        title: 'guidance.registered.title',
        summary: `guidance.registered.${origin}.summary` as GuidanceKey,
        steps: [
          hasFingerprint
            ? (`guidance.registered.${origin}.step.verify` as GuidanceKey)
            : 'guidance.registered.step.verifyWithoutFingerprint',
          ...(origin === 'fdroid'
            ? ['guidance.registered.fdroid.step.track' as GuidanceKey]
            : []),
          'guidance.registered.step.status',
          'guidance.registered.step.docs',
        ],
      };
    case 'registered_other_key':
      return {
        title: 'guidance.registered_other_key.title',
        summary: `guidance.registered_other_key.${origin}.summary` as GuidanceKey,
        steps: [
          ...(hasFingerprint
            ? ['guidance.registered_other_key.step.fingerprint' as GuidanceKey]
            : []),
          'guidance.registered_other_key.step.identify',
          'guidance.registered_other_key.step.add',
        ],
      };
    case 'not_registered':
      return {
        title: 'guidance.not_registered.title',
        summary: `guidance.not_registered.${origin}.summary` as GuidanceKey,
        steps: [
          `guidance.not_registered.${origin}.step.register` as GuidanceKey,
          ...(origin === 'fdroid'
            ? ['guidance.not_registered.fdroid.step.repro' as GuidanceKey]
            : []),
          'guidance.not_registered.step.check',
        ],
      };
    case 'unknown':
      return {
        title: 'guidance.unknown.title',
        summary: `guidance.unknown.${origin}.summary` as GuidanceKey,
        steps: [
          'guidance.unknown.step.check',
          'guidance.unknown.step.inspect',
          'guidance.unknown.step.docs',
        ],
      };
  }
}

export function getGuidance(status: AppStatus, ctx: GuidanceContext): Guidance {
  const keys = contentKeys(status, ctx.origin, ctx.fingerprint !== undefined);
  const params = paramsFor(ctx);
  return {
    title: t(keys.title, params),
    summary: t(keys.summary, params),
    steps: keys.steps.map((key) => t(key, params)),
    links: linksFor(status),
  };
}

export { en, type GuidanceKey };
