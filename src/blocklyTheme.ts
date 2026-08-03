/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as Blockly from 'blockly/core';

export const systemCoreTheme = Blockly.Theme.defineTheme('systemcore', {
  name: 'systemcore',
  base: 'classic',
  // Scratch-style "start hats" on top of hat-less blocks (opmodes, etc.).
  startHats: true,
  blockStyles: {
    math_blocks: {
      colourPrimary: '#59C059',
      colourSecondary: '#46A746',
      colourTertiary: '#389438',
    },
    logic_blocks: {
      colourPrimary: '#59C059',
      colourSecondary: '#46A746',
      colourTertiary: '#389438',
    },
    control_blocks: {
      colourPrimary: '#FFAB19',
      colourSecondary: '#CF8B17',
      colourTertiary: '#B87814',
    },
  },
  categoryStyles: {
    motion_category: { colour: '#4C97FF' },
    movement_category: { colour: '#FF4DCD' },
    events_category: { colour: '#FFBF00' },
    control_category: { colour: '#FFAB19' },
    sensing_category: { colour: '#5CB1D6' },
    wpilib_sensors_category: { colour: '#FF4C4C' },
    wpilib_outputs_category: { colour: '#0FBC9B' },
    rev_sensors_category: { colour: '#FF5418' },
    operators_category: { colour: '#59C059' },
    variables_category: { colour: '#FF8C1A' },
    myblocks_category: { colour: '#FF6680' },
    advanced_category: { colour: '#5C81A6' },

    logic_category: { colour: '#5C81A6' },
    loop_category: { colour: '#FFAB19' },
    math_category: { colour: '#59C059' },
    text_category: { colour: '#FF8C1A' },
    list_category: { colour: '#FF661A' },
    variable_category: { colour: '#FF8C1A' },
    procedure_category: { colour: '#FF6680' },
  },
  componentStyles: {
    workspaceBackgroundColour: '#F8FAFC',
    toolboxBackgroundColour: '#FFFFFF',
    toolboxForegroundColour: '#334155',
    flyoutBackgroundColour: '#FFFFFF',
    flyoutForegroundColour: '#334155',
    flyoutOpacity: 1,
    scrollbarColour: '#94A3B8',
    scrollbarOpacity: 0.4,
    insertionMarkerColour: '#2563EB',
    insertionMarkerOpacity: 0.35,
    markerColour: '#2563EB',
    cursorColour: '#2563EB',
    selectedGlowColour: '#2563EB',
    selectedGlowOpacity: 0.35,
  },
  fontStyle: {
    family:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    weight: '700',
    size: 13,
  },
});
