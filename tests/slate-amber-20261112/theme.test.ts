import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { parseThemeCookie, resolveThemeCookie } from "@/lib/theme/storage";
import { THEMES, THEME_IDS } from "@/lib/theme/themes";
const css = readFileSync("app/globals.css", "utf8");
const dark = css.slice(css.indexOf('/* Slate & Amber'));
const values = new Map([...dark.matchAll(/(--[\w-]+)\s*:\s*(#[\dA-Fa-f]{6})\s*;/g)].map(m => [m[1]!, m[2]!]));
function luminance(hex: string) { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]!*.2126+c[1]!*.7152+c[2]!*.0722; }
function contrast(a:string,b:string){const v=[luminance(a),luminance(b)].sort((a,b)=>a-b);return(v[1]!+.05)/(v[0]!+.05);}
describe("Slate & Amber",()=>{
 it("validates the stored preference and retains the safe default",()=>{expect(parseThemeCookie('dark')).toBe('dark');expect(resolveThemeCookie('invalid')).toBe('mint');expect(THEME_IDS).toEqual(['mint','lavender','dark']);expect(THEMES.dark.label).toBe('Slate & Amber');});
 it("changes no geometry or typography declarations",()=>{expect(dark).toContain('[data-theme="dark"]');expect(dark.replace(/\/\*[\s\S]*?\*\//g,'')).not.toMatch(/(?:^|[;{\s])(?:display|position|padding|margin|gap|width|height|top|left|right|bottom|transform|font-size|font-weight|line-height|grid-template-columns)\s*:/);});
 it("keeps text, statuses and primary actions readable",()=>{for(const t of ['--color-ink','--color-ink-2','--color-ink-3'])for(const b of ['--color-deck','--color-paper'])expect(contrast(values.get(t)!,values.get(b)!)).toBeGreaterThanOrEqual(4.5);for(const [t,b] of [['--color-good','--color-good-soft'],['--color-warn','--color-warn-soft'],['--color-late','--color-late-soft'],['--action-foreground','--accent-strong']])expect(contrast(values.get(t!)!,values.get(b!)!)).toBeGreaterThanOrEqual(4.5);});
});
