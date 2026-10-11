/**
 * The mock UI's demo page: several EDSSIs on one page, each its own instance of the real app.
 * `?tab=<id>` instead shows one window filling the page, for a closer look or a screenshot.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { TAB_IDS, type TabId } from '../../shared/ui';
import { demoScenario } from '../fixtures/demo';
import { MockApp } from '../mock-app';
import type { MockScenario } from '../scenario';
import { Scaled } from './Scaled';

import '../fonts.css';
import './demo.css';

/** The same trip in three EDHM themes: the HUD colour is each window's own. */
const THEMES: { name: string; scenario: MockScenario }[] = [
  { name: 'Elite orange', scenario: demoScenario },
  { name: 'Azure', scenario: { ...demoScenario, hudColor: { color: '#3d8bff', theme: 'Azure' } } },
  {
    name: 'Viridian',
    scenario: { ...demoScenario, hudColor: { color: '#2fd27a', theme: 'Viridian' } },
  },
];

const MODULES: { tab: TabId; title: string; text: string }[] = [
  {
    tab: 'route',
    title: 'Route',
    text: 'The plotted route and a Spansh CSV route side by side, with the next system on the clipboard after every jump and a 3D map of the stretch flown.',
  },
  {
    tab: 'materials',
    title: 'Materials',
    text: 'Engineering and synthesis to-dos planned against what the commander carries, and which trader turns spare stock into what is missing.',
  },
  {
    tab: 'ships',
    title: 'Ships',
    text: 'Every ship owned, slot by slot from EDSY’s tables, empty slots included, and the fleet carrier’s fuel and upkeep.',
  },
  {
    tab: 'comms',
    title: 'Comms',
    text: 'The assistant: ask by voice, answered aloud from the journal, Spansh, EDSM and the web.',
  },
  {
    tab: 'commodities',
    title: 'Commodities',
    text: 'A colonisation shopping list, counted down as the game buys it, and the fewest-stops plan to fill it.',
  },
  {
    tab: 'journal',
    title: 'Journal',
    text: 'The session as the game writes it, folded into jumps, scans and samples.',
  },
];

function Demo() {
  return (
    <main className="demo">
      <header className="demo-head">
        <p className="demo-kicker">Mock UI</p>
        <h1>
          <span>EDSSI</span> Elite Dangerous Smart Support Interface
        </h1>
        <p className="demo-lede">
          Every window on this page is the real app, drawn by its own components against a made-up
          exobiology trip, and each is its own instance: click about, nothing one does reaches
          another.
        </p>
      </header>

      <section className="demo-hero">
        <Scaled>
          <MockApp scenario={demoScenario} tab="mission" />
        </Scaled>
        <p className="demo-caption">
          <b>Mission</b> — six jumps out from the carrier, low over a world with three genera; 50
          million in samples unsold, the side panel tracking fuel along the route.
        </p>
      </section>

      <section>
        <h2>Every module</h2>
        <div className="demo-grid">
          {MODULES.map((module) => (
            <figure key={module.tab} className="demo-card">
              <Scaled>
                <MockApp scenario={demoScenario} tab={module.tab} />
              </Scaled>
              <figcaption>
                <b>{module.title}</b> {module.text}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section>
        <h2>In the HUD’s colour</h2>
        <p className="demo-text">
          EDSSI reads the EDHM theme the game is drawn in and mixes its whole palette from that one
          colour. Three instances, three themes, one page.
        </p>
        <div className="demo-grid demo-grid-3">
          {THEMES.map((theme) => (
            <figure key={theme.name} className="demo-card">
              <Scaled height={620}>
                <MockApp scenario={theme.scenario} tab="mission" />
              </Scaled>
              <figcaption>
                <b>{theme.name}</b>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section>
        <h2>Settings</h2>
        <figure className="demo-card">
          <Scaled>
            <MockApp scenario={demoScenario} tab="settings" />
          </Scaled>
          <figcaption>
            <b>Settings</b> The whole settings file as a form, starting with Quickstart: the
            assistant, hearing, speaking and VR, each the few fields it can’t work without.
          </figcaption>
        </figure>
      </section>

      <footer className="demo-foot">
        Made by <code>npm run mock:scenario</code> from a fixture journal run through EDSSI’s own
        services. Embed it with <code>{'<MockApp scenario={demoScenario} tab="materials" />'}</code>
        .
      </footer>
    </main>
  );
}

function isTab(value: string | null): value is TabId {
  return value !== null && (TAB_IDS as readonly string[]).includes(value);
}

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing');
const tab = new URLSearchParams(window.location.search).get('tab');

createRoot(root).render(
  <StrictMode>
    {isTab(tab) ? (
      // Scaled to the page's width, so the whole window shows in a small browser too.
      <div className="demo-solo">
        <Scaled>
          <MockApp scenario={demoScenario} tab={tab} />
        </Scaled>
      </div>
    ) : (
      <Demo />
    )}
  </StrictMode>,
);
