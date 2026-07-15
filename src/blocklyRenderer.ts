import * as Blockly from "blockly";

const RENDERER_NAME = "systemcore_zelos";
const SIDE_BY_SIDE_COMMAND_GROUPS = new Set([
  "sc_parallel_commands",
  "sc_race_commands",
  "sc_deadline_commands",
]);

class SystemCoreRenderInfo extends Blockly.zelos.RenderInfo {
  override measure() {
    super.measure();

    if (!SIDE_BY_SIDE_COMMAND_GROUPS.has(this.block_.type)) return;

    const branchGap = 24;
    const branchRow = this.inputRows.find(
      (row) =>
        row.elements.filter((element) =>
          element instanceof Blockly.zelos.StatementInput
        ).length > 1,
    );
    if (!branchRow) return;

    const branchInputs = branchRow.elements.filter(
      (element): element is Blockly.zelos.StatementInput =>
        element instanceof Blockly.zelos.StatementInput,
    );
    const branchesWidth = branchInputs.reduce(
      (width, input) => width + Math.max(input.connectedBlockWidth, input.width),
      0,
    );
    const requiredWidth =
      branchRow.xPos +
      branchRow.statementEdge +
      branchesWidth +
      branchGap * (branchInputs.length - 1) +
      this.constants_.MEDIUM_PADDING;
    const extraWidth = Math.max(0, requiredWidth - this.width);
    if (!extraWidth) return;

    this.width += extraWidth;
    this.widthWithChildren = Math.max(this.widthWithChildren, this.width);

    for (const row of this.rows) {
      row.width += extraWidth;
      row.widthWithConnectedBlocks += extraWidth;
      const trailingSpacer = row.getLastSpacer();
      if (trailingSpacer) trailingSpacer.width += extraWidth;
    }
  }

  override shouldStartNewRow_(
    currentInput: Blockly.Input,
    previousInput: Blockly.Input,
  ) {
    if (
      SIDE_BY_SIDE_COMMAND_GROUPS.has(this.block_.type) &&
      currentInput.type === Blockly.inputs.inputTypes.STATEMENT &&
      previousInput.type === Blockly.inputs.inputTypes.STATEMENT
    ) {
      return false;
    }

    return super.shouldStartNewRow_(currentInput, previousInput);
  }
}

class SystemCoreDrawer extends Blockly.zelos.Drawer {
  override drawStatementInput_(row: Blockly.blockRendering.Row) {
    super.drawStatementInput_(row);
    if (!SIDE_BY_SIDE_COMMAND_GROUPS.has(this.block_.type)) return;

    const branchInputs = row.elements.filter(
      (element): element is Blockly.zelos.StatementInput =>
        element instanceof Blockly.zelos.StatementInput,
    );
    if (branchInputs.length < 2) return;

    const branchGap = 24;
    const firstBranch = branchInputs[0];
    const firstBranchX = row.xPos + row.statementEdge;
    const dividerX =
      firstBranchX +
      Math.max(firstBranch.connectedBlockWidth, firstBranch.width) +
      branchGap / 2;
    const wallWidth = 16;
    const pathObject = this.block_.pathObject as Blockly.zelos.PathObject;
    const separatorPath = [
      `M ${dividerX - wallWidth / 2} ${row.yPos}`,
      `h ${wallWidth}`,
      `v ${row.height}`,
      `h ${-wallWidth}`,
      "z",
    ].join(" ");
    pathObject.setOutlinePath("systemcore-branch-separator", separatorPath);
    const separator = pathObject.getOutlinePath(
      "systemcore-branch-separator",
    );
    separator.setAttribute("fill", this.block_.getColour());
    separator.setAttribute("stroke", "none");
    separator.style.fill = this.block_.getColour();
    separator.style.stroke = "none";
    let branchX = firstBranchX;

    branchInputs.forEach((branch, index) => {
      if (index > 0) {
        const shape = branch.shape as Blockly.blockRendering.Notch;
        const notchRight = branchX + branch.notchOffset + shape.width;
        const detailPath = [
          `M ${notchRight} ${row.yPos}`,
          shape.pathRight,
          "z",
        ].join(" ");
        const pathName = `systemcore-branch-notch-${index}`;
        pathObject.setOutlinePath(pathName, detailPath);
        const detail = pathObject.getOutlinePath(pathName);
        detail.setAttribute("fill", this.block_.getColour());
      }

      branchX += Math.max(branch.connectedBlockWidth, branch.width) + branchGap;
    });
  }

  protected override positionStatementInputConnection_(
    row: Blockly.blockRendering.Row,
  ) {
    if (!SIDE_BY_SIDE_COMMAND_GROUPS.has(this.block_.type)) {
      super.positionStatementInputConnection_(row);
      return;
    }

    const branchGap = 24;
    let branchX = row.xPos + row.statementEdge;

    for (const element of row.elements) {
      if (
        !(element instanceof Blockly.zelos.StatementInput) ||
        !element.connectionModel
      ) {
        continue;
      }

      const x = branchX + element.notchOffset;
      element.connectionModel.setOffsetInBlock(this.info_.RTL ? -x : x, row.yPos);
      branchX += Math.max(element.connectedBlockWidth, element.width) + branchGap;
    }
  }
}

class SystemCoreRenderer extends Blockly.zelos.Renderer {
  protected override makeRenderInfo_(block: Blockly.BlockSvg) {
    return new SystemCoreRenderInfo(this, block);
  }

  protected override makeDrawer_(
    block: Blockly.BlockSvg,
    info: Blockly.blockRendering.RenderInfo,
  ) {
    return new SystemCoreDrawer(block, info as SystemCoreRenderInfo);
  }
}

let registered = false;

export const registerSystemCoreRenderer = () => {
  if (registered) return;
  Blockly.blockRendering.register(RENDERER_NAME, SystemCoreRenderer);
  registered = true;
};

export { RENDERER_NAME as systemCoreRendererName };
