/**
 * Installs Blockly's English locale.
 *
 * The `blockly` entry point does this as a side effect, but we import
 * `blockly/core` instead so the unused JavaScript/PHP/Lua/Dart generators stay
 * out of the bundle — which also means no locale. With an empty `Blockly.Msg`,
 * every `%{BKY_*}` reference in the standard blocks and toolbox fails to
 * resolve and the palette cannot render.
 *
 * Import this *before* `blockly/blocks`: module evaluation follows import order,
 * so the messages have to be in place first.
 */
import * as Blockly from 'blockly/core';
import * as En from 'blockly/msg/en';

Blockly.setLocale(En as unknown as { [key: string]: string });
