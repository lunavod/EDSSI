/**
 * Every toolset the assistant has. A new area of the app is a new file here and a line in this
 * list; its tools, its instructions and the state it puts in front of each question stay together.
 */

import type { Toolset } from '../tools/define';
import { activityToolset } from './activity';
import { appToolset } from './app';
import { browserToolset } from './browser';
import { calculatorToolset } from './calculator';
import { carrierToolset } from './carrier';
import { explorationToolset } from './exploration';
import { galaxyToolset } from './galaxy';
import { journalToolset } from './journal';
import { missionToolset } from './mission';
import { navigationToolset } from './navigation';
import { shipToolset } from './ship';
import { spanshToolset } from './spansh';
import { webToolset } from './web';

export const TOOLSETS: Toolset[] = [
  shipToolset,
  carrierToolset,
  navigationToolset,
  explorationToolset,
  missionToolset,
  activityToolset,
  journalToolset,
  galaxyToolset,
  spanshToolset,
  webToolset,
  browserToolset,
  calculatorToolset,
  appToolset,
];
