import * as Blockly from 'blockly';

export const SC_TYPED_VARIABLE_CATEGORY = 'SC_TYPED_VARIABLE';

export const varTypeAnnotation = (type: string): string | null => {
  switch (type) {
    case '': return null;
    case 'Number': return 'float';
    case 'Integer': return 'int';
    case 'Boolean': return 'bool';
    case 'Text': return 'str';
    case 'List': return 'list';
    default: return `${type} | None`;
  }
};

export const varDefaultValue = (type: string): string => {
  switch (type) {
    case 'Number': return '0.0';
    case 'Integer': return '0';
    case 'Boolean': return 'False';
    case 'Text': return '""';
    case 'List': return '[]';
    default: return 'None';
  }
};

const promptVariableName = (workspace: Blockly.WorkspaceSvg, type: string) => {
  Blockly.dialog.prompt('Variable name:', '', (name) => {
    if (name && name.trim()) {
      workspace.getVariableMap().createVariable(name.trim(), type);
      workspace.getToolbox()?.refreshSelection();
    }
  });
};

export const registerTypedVariableCategory = (workspace: Blockly.WorkspaceSvg) => {
  workspace.registerToolboxCategoryCallback(
    SC_TYPED_VARIABLE_CATEGORY,
    (ws: Blockly.WorkspaceSvg) => {
      const contents: Blockly.utils.toolbox.FlyoutItemInfo[] = [];

      contents.push({kind: 'button', text: 'Create variable...', callbackkey: 'SC_VAR_CREATE'});
      contents.push({kind: 'button', text: 'Create number...', callbackkey: 'SC_VAR_CREATE_NUMBER'});
      contents.push({kind: 'button', text: 'Create integer...', callbackkey: 'SC_VAR_CREATE_INTEGER'});
      contents.push({kind: 'button', text: 'Create boolean...', callbackkey: 'SC_VAR_CREATE_BOOLEAN'});
      contents.push({kind: 'button', text: 'Create text...', callbackkey: 'SC_VAR_CREATE_TEXT'});
      contents.push({kind: 'button', text: 'Create list...', callbackkey: 'SC_VAR_CREATE_LIST'});
      contents.push({kind: 'button', text: 'Create object...', callbackkey: 'SC_VAR_CREATE_OBJECT'});

      const allVars = ws.getVariableMap().getAllVariables();
      if (allVars.length > 0) {
        contents.push({kind: 'sep'});
        const varBlocks = Blockly.Variables.jsonFlyoutCategoryBlocks(ws, allVars, true);
        contents.push(...varBlocks);
      }

      contents.push({kind: 'sep'});
      contents.push({kind: 'block', type: 'sc_new_object'});
      contents.push({kind: 'block', type: 'sc_object_call'});
      contents.push({kind: 'block', type: 'sc_object_value'});

      return contents;
    },
  );

  workspace.registerButtonCallback('SC_VAR_CREATE', () => {
    Blockly.Variables.createVariableButtonHandler(workspace, undefined, '');
  });
  workspace.registerButtonCallback('SC_VAR_CREATE_NUMBER', () => promptVariableName(workspace, 'Number'));
  workspace.registerButtonCallback('SC_VAR_CREATE_INTEGER', () => promptVariableName(workspace, 'Integer'));
  workspace.registerButtonCallback('SC_VAR_CREATE_BOOLEAN', () => promptVariableName(workspace, 'Boolean'));
  workspace.registerButtonCallback('SC_VAR_CREATE_TEXT', () => promptVariableName(workspace, 'Text'));
  workspace.registerButtonCallback('SC_VAR_CREATE_LIST', () => promptVariableName(workspace, 'List'));
  workspace.registerButtonCallback('SC_VAR_CREATE_OBJECT', () => {
    Blockly.dialog.prompt('Class name:', 'wpilib.Pose2d', (className) => {
      if (!className || !className.trim()) return;
      const trimmedClass = className.trim();
      Blockly.dialog.prompt('Variable name:', '', (name) => {
        if (name && name.trim()) {
          workspace.getVariableMap().createVariable(name.trim(), trimmedClass);
          workspace.getToolbox()?.refreshSelection();
        }
      });
    });
  });
};
