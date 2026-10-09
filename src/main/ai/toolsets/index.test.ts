import { describe, expect, it } from 'vitest';

import { ToolRegistry } from '../tools/registry';
import { TOOLSETS } from './index';

describe('TOOLSETS', () => {
  it('gives every tool a unique name and a schema the API accepts', () => {
    const registry = new ToolRegistry(TOOLSETS);
    const names = registry.definitions().map((definition) => definition.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'get_current_system',
        'get_biology_here',
        'get_exobiology_log',
        'get_activity_summary',
        'get_journey',
        'find_visits',
        'get_career',
        'get_missions',
        'spansh_search',
        'spansh_get_system',
        'spansh_plot_neutron_route',
        'spansh_plot_exact_route',
        'spansh_route_result',
        'calculate',
        'fetch_page',
        'browser_open',
        'browser_read',
        'browser_screenshot',
      ]),
    );
    for (const definition of registry.definitions()) {
      expect(definition.parameters).toMatchObject({ type: 'object' });
    }
  });

  it("tells the model when the commander's day starts", () => {
    expect(new ToolRegistry(TOOLSETS).instructions()).toContain('starts at 6:00 local time');
  });
});
