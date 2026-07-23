import { PIECE_SETS, currentPieceSet, setPieceSet, pieceImageUrl } from './piecesets';

/** Back rank in file order, reused for both the preview's back-rank row and
 * to key generated-set filenames (b + role, e.g. `bp`, `bn`). */
const BACK_RANK_ROLES = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'] as const;

function buildPreviewRow(roles: readonly string[], setId: string, rowIndex: number): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'settings-preview-row';

  const set = PIECE_SETS.find(s => s.id === setId);
  const isBuiltin = !set || set.builtin;

  roles.forEach((role, colIndex) => {
    const square = document.createElement('div');
    square.className = `settings-preview-square ${(rowIndex + colIndex) % 2 === 0 ? 'settings-preview-square--light' : 'settings-preview-square--dark'}`;

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
  const initial = currentPieceSet();
  let selected = initial;

  const overlay = document.createElement('div');
  overlay.className = 'promotion-modal-overlay';

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
    preview.appendChild(buildPreviewRow(BACK_RANK_ROLES, selected, 0));
    preview.appendChild(buildPreviewRow(BACK_RANK_ROLES.map(() => 'p'), selected, 1));
  }
  renderPreview();

  const field = document.createElement('label');
  field.className = 'settings-field';
  field.htmlFor = 'settings-pieceset';
  const fieldLabel = document.createElement('span');
  fieldLabel.className = 'settings-field-label';
  fieldLabel.textContent = 'Pieces';
  const select = document.createElement('select');
  select.className = 'settings-select';
  select.id = 'settings-pieceset';
  select.name = 'pieceset';
  for (const set of PIECE_SETS) {
    const opt = document.createElement('option');
    opt.value = set.id;
    opt.textContent = set.label;
    opt.selected = set.id === selected;
    select.appendChild(opt);
  }
  select.onchange = () => {
    selected = select.value;
    renderPreview();
  };
  field.append(fieldLabel, select);
  modal.appendChild(field);

  const buttons = document.createElement('div');
  buttons.className = 'settings-buttons';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => {
    overlay.remove();
    onClose();
  };

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = 'Save';
  saveBtn.onclick = () => {
    setPieceSet(selected);
    overlay.remove();
    onClose();
  };

  buttons.append(cancelBtn, saveBtn);
  modal.appendChild(buttons);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}
