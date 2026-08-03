import * as Blockly from 'blockly/core';
import {Order, type PythonGenerator} from 'blockly/python';

const COLOUR = 230;

const scNewObject = {
  type: 'sc_new_object',
  message0: 'new %1',
  args0: [
    {
      type: 'field_input',
      name: 'CLASS',
      text: 'wpilib.Pose2d',
      spellcheck: false,
    },
  ],
  output: null,
  colour: COLOUR,
  tooltip: 'Construct a new object.',
  helpUrl: '',
  mutator: 'sc_new_object_mutator',
};

const scNewObjectContainer = {
  type: 'sc_new_object_container',
  message0: 'constructor args',
  args0: [],
  nextStatement: null,
  colour: COLOUR,
  tooltip: '',
  helpUrl: '',
};

const scNewObjectItem = {
  type: 'sc_new_object_item',
  message0: 'arg',
  args0: [],
  previousStatement: null,
  nextStatement: null,
  colour: COLOUR,
  tooltip: '',
  helpUrl: '',
};

const scObjectCall = {
  type: 'sc_object_call',
  message0: '%1 . %2',
  args0: [
    {type: 'input_value', name: 'OBJECT'},
    {
      type: 'field_input',
      name: 'METHOD',
      text: 'method_name',
      spellcheck: false,
    },
  ],
  inputsInline: true,
  previousStatement: null,
  nextStatement: null,
  colour: COLOUR,
  tooltip: 'Call a method on an object variable.',
  helpUrl: '',
  mutator: 'sc_ext_args_mutator',
};

const scObjectValue = {
  type: 'sc_object_value',
  message0: '%1 . %2',
  args0: [
    {type: 'input_value', name: 'OBJECT'},
    {
      type: 'field_input',
      name: 'METHOD',
      text: 'method_name',
      spellcheck: false,
    },
  ],
  inputsInline: true,
  output: null,
  colour: COLOUR,
  tooltip: 'Read a value from a method on an object variable.',
  helpUrl: '',
  mutator: 'sc_ext_args_mutator',
};

export const variableBlockDefinitions =
  Blockly.common.createBlockDefinitionsFromJsonArray([
    scNewObject,
    scNewObjectContainer,
    scNewObjectItem,
    scObjectCall,
    scObjectValue,
  ]);

Blockly.Extensions.registerMutator(
  'sc_new_object_mutator',
  {
    itemCount_: 0,

    saveExtraState(this: any): {itemCount: number} {
      return {itemCount: this.itemCount_};
    },

    loadExtraState(this: any, state: {itemCount: number}) {
      this.itemCount_ = state.itemCount;
      this.updateShape_();
    },

    decompose(
      this: any,
      mutatorWorkspace: Blockly.WorkspaceSvg,
    ): Blockly.Block {
      const containerBlock = mutatorWorkspace.newBlock(
        'sc_new_object_container',
      );
      (containerBlock as any).initSvg();
      let connection = containerBlock.nextConnection;
      for (let i = 0; i < this.itemCount_; i++) {
        const itemBlock = mutatorWorkspace.newBlock('sc_new_object_item');
        (itemBlock as any).initSvg();
        if (connection) {
          connection.connect(itemBlock.previousConnection!);
          connection = itemBlock.nextConnection;
        }
      }
      return containerBlock;
    },

    compose(this: any, containerBlock: Blockly.Block) {
      let itemBlock: Blockly.Block | null = containerBlock.getNextBlock();
      const connections: (Blockly.Connection | null)[] = [];
      while (itemBlock) {
        if (itemBlock.isInsertionMarker()) {
          itemBlock = itemBlock.getNextBlock();
          continue;
        }
        connections.push((itemBlock as any).valueConnection_ || null);
        itemBlock = itemBlock.getNextBlock();
      }
      for (let i = 0; i < this.itemCount_; i++) {
        const conn = this.getInput('ARG' + i)?.connection?.targetConnection;
        if (conn && connections.indexOf(conn) === -1) {
          conn.getSourceBlock().unplug();
        }
      }
      this.itemCount_ = connections.length;
      this.updateShape_();
      for (let i = 0; i < this.itemCount_; i++) {
        const conn = connections[i];
        if (conn) {
          conn.reconnect(this, 'ARG' + i);
        }
      }
    },

    saveConnections(this: any, containerBlock: Blockly.Block) {
      let itemBlock: Blockly.Block | null = containerBlock.getNextBlock();
      let i = 0;
      while (itemBlock) {
        if (itemBlock.isInsertionMarker()) {
          itemBlock = itemBlock.getNextBlock();
          continue;
        }
        (itemBlock as any).valueConnection_ =
          this.getInput('ARG' + i)?.connection?.targetConnection ?? null;
        i++;
        itemBlock = itemBlock.getNextBlock();
      }
    },

    updateShape_(this: any) {
      let i = 0;
      while (this.getInput('ARG' + i)) {
        this.removeInput('ARG' + i);
        i++;
      }
      if (this.getInput('CLOSE')) this.removeInput('CLOSE');
      for (let j = 0; j < this.itemCount_; j++) {
        this.appendValueInput('ARG' + j)
          .setAlign(Blockly.inputs.Align.RIGHT)
          .appendField(j === 0 ? '(' : ',');
      }
      if (this.itemCount_ > 0) {
        this.appendDummyInput('CLOSE').appendField(')');
      }
    },
  },
  undefined,
  ['sc_new_object_item'],
);

export const registerVariableBlocks = () => {
  if (!Blockly.Blocks['sc_new_object']) {
    Blockly.common.defineBlocks(variableBlockDefinitions);
  }
};

const collectArgs = (
  block: Blockly.Block,
  generator: PythonGenerator,
): string => {
  const args: string[] = [];
  let i = 0;
  while (block.getInput('ARG' + i)) {
    args.push(generator.valueToCode(block, 'ARG' + i, Order.NONE) || 'None');
    i++;
  }
  return args.join(', ');
};

export const variableForBlock: Record<
  string,
  (block: Blockly.Block, generator: PythonGenerator) => [string, Order] | string
> = {
  sc_new_object(
    block: Blockly.Block,
    generator: PythonGenerator,
  ): [string, Order] {
    const className = (block.getFieldValue('CLASS') || 'object').trim();
    return [
      `${className}(${collectArgs(block, generator)})`,
      Order.FUNCTION_CALL,
    ];
  },

  sc_object_call(block: Blockly.Block, generator: PythonGenerator): string {
    const obj = generator.valueToCode(block, 'OBJECT', Order.MEMBER) || 'None';
    const method = (block.getFieldValue('METHOD') || 'method').trim();
    return `${obj}.${method}(${collectArgs(block, generator)})\n`;
  },

  sc_object_value(
    block: Blockly.Block,
    generator: PythonGenerator,
  ): [string, Order] {
    const obj = generator.valueToCode(block, 'OBJECT', Order.MEMBER) || 'None';
    const method = (block.getFieldValue('METHOD') || 'method').trim();
    return [
      `${obj}.${method}(${collectArgs(block, generator)})`,
      Order.FUNCTION_CALL,
    ];
  },
};
