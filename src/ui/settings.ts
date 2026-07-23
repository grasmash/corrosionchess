import { PIECE_SETS, currentPieceSet, setPieceSet, pieceImageUrl } from './piecesets';
import { BOARD_THEMES, currentBoardTheme, setBoardTheme } from './boardthemes';
import type { BoardTheme } from './boardthemes';

/** Back rank in file order, reused for both the preview's back-rank row and
 * to key generated-set filenames (b + role, e.g. `bp`, `bn`). */
const BACK_RANK_ROLES = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'] as const;

function buildPreviewRow(roles: readonly string[], setId: string, rowIndex: number, theme: BoardTheme): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'settings-preview-row';

  const set = PIECE_SETS.find(s => s.id === setId);
  const isBuiltin = !set || set.builtin;

  roles.forEach((role, colIndex) => {
    const square = document.createElement('div');
    square.className = 'settings-preview-square';
    // Inline (not the `--board-*` custom props) deliberately: the preview
    // must reflect the in-modal, not-yet-saved board-theme selection, while
    // the live board only re-skins on Save (see `setBoardTheme` below) --
    // if this read the CSS vars instead, changing the dropdown pre-Save
    // would re-skin the live board underneath the modal too.
    const isDark = (rowIndex + colIndex) % 2 !== 0;
    square.style.backgroundColor = isDark ? theme.dark : theme.light;
    // Plan 006: same technique as the live board's cg-board::before overlay
    // (style.css) -- the dark texture blended over the flat color -- but
    // inline, and only on dark squares here (the preview is small enough
    // that a per-square image reads cleanly, unlike the live board where a
    // single full-board blended layer was the simpler/safer choice). Themes
    // without `darkTex` leave `backgroundImage` unset, so this is a no-op
    // for every non-corroded theme.
    if (isDark && theme.darkTex) {
      square.style.backgroundImage = `url(${theme.darkTex})`;
      square.style.backgroundSize = 'cover';
      square.style.backgroundBlendMode = 'multiply';
    }

    if (isBuiltin) {
      // Reuses pieces-cburnett.css's own selectors (`.cg-wrap piece.<role>-
      // piece.<color>`) by wrapping the whole preview in a `.cg-wrap` --
      // see the container below -- rather than duplicating cburnett's SVGs.
      const piece = document.createElement('piece');
      piece.className = `${role}-piece black`;
      square.appendChild(piece);
    } else {
      const img = document.createElement('img');
      img.className = 'settings-preview-img';
      img.src = pieceImageUrl(setId, `b${role}`);
      img.alt = '';
      square.appendChild(img);
    }

    row.appendChild(square);
  });

  return row;
}

/**
 * Chess.com-style settings modal (dark, rounded card, same shell as the
 * promotion modal). Shows a live preview of the selected piece set (black
 * back rank over black pawns on alternating squares), a "Pieces" dropdown,
 * and Cancel/Save. Save persists the choice (which immediately re-skins any
 * mounted board via `setPieceSet` -> `applyPieceSet`'s injected stylesheet);
 * Cancel discards the in-modal selection -- nothing is applied until Save,
 * so there's nothing to revert.
 */
export function showSettings(onClose: () => void): void {
  let selectedPieceSet = currentPieceSet();
  let selectedBoardTheme = currentBoardTheme();

  const overlay = document.createElement('div');
  overlay.className = 'promotion-modal-overlay';
  overlay.onclick = e => {
    if (e.target === overlay) cancel();
  };

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') cancel();
  }
  document.addEventListener('keydown', onKeydown);

  function cancel(): void {
    // Same semantics as the Cancel button: nothing was ever applied to the
    // live board pre-Save (see the doc comment above), so there's nothing
    // to actively revert -- just close without persisting the in-modal
    // selection.
    document.removeEventListener('keydown', onKeydown);
    overlay.remove();
    onClose();
  }

  const modal = document.createElement('div');
  modal.className = 'promotion-modal settings-modal';

  const title = document.createElement('div');
  title.className = 'promotion-modal-title';
  title.textContent = 'Settings';
  modal.appendChild(title);

  const preview = document.createElement('div');
  preview.className = 'settings-preview cg-wrap';
  modal.appendChild(preview);

  function renderPreview(): void {
    preview.innerHTML = '';
    const theme = BOARD_THEMES.find(t => t.id === selectedBoardTheme) ?? BOARD_THEMES[0];
    preview.appendChild(buildPreviewRow(BACK_RANK_ROLES, selectedPieceSet, 0, theme));
    preview.appendChild(buildPreviewRow(BACK_RANK_ROLES.map(() => 'p'), selectedPieceSet, 1, theme));
  }
  renderPreview();

  const pieceField = document.createElement('label');
  pieceField.className = 'settings-field';
  pieceField.htmlFor = 'settings-pieceset';
  const pieceFieldLabel = document.createElement('span');
  pieceFieldLabel.className = 'settings-field-label';
  pieceFieldLabel.textContent = 'Pieces';
  const pieceSelect = document.createElement('select');
  pieceSelect.className = 'settings-select';
  pieceSelect.id = 'settings-pieceset';
  pieceSelect.name = 'pieceset';
  for (const set of PIECE_SETS) {
    const opt = document.createElement('option');
    opt.value = set.id;
    opt.textContent = set.label;
    opt.selected = set.id === selectedPieceSet;
    pieceSelect.appendChild(opt);
  }
  pieceSelect.onchange = () => {
    selectedPieceSet = pieceSelect.value;
    renderPreview();
  };
  pieceField.append(pieceFieldLabel, pieceSelect);
  modal.appendChild(pieceField);

  const boardField = document.createElement('label');
  boardField.className = 'settings-field';
  boardField.htmlFor = 'settings-boardtheme';
  const boardFieldLabel = document.createElement('span');
  boardFieldLabel.className = 'settings-field-label';
  boardFieldLabel.textContent = 'Board';
  const boardSelect = document.createElement('select');
  boardSelect.className = 'settings-select';
  boardSelect.id = 'settings-boardtheme';
  boardSelect.name = 'boardtheme';
  for (const theme of BOARD_THEMES) {
    const opt = document.createElement('option');
    opt.value = theme.id;
    opt.textContent = theme.label;
    opt.selected = theme.id === selectedBoardTheme;
    boardSelect.appendChild(opt);
  }
  boardSelect.onchange = () => {
    selectedBoardTheme = boardSelect.value;
    renderPreview();
  };
  boardField.append(boardFieldLabel, boardSelect);
  modal.appendChild(boardField);

  const buttons = document.createElement('div');
  buttons.className = 'settings-buttons';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => cancel();

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = 'Save';
  saveBtn.onclick = () => {
    setPieceSet(selectedPieceSet);
    setBoardTheme(selectedBoardTheme);
    document.removeEventListener('keydown', onKeydown);
    overlay.remove();
    onClose();
  };

  buttons.append(cancelBtn, saveBtn);
  modal.appendChild(buttons);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}
