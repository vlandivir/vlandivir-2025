(function initVideoUploadBlock(global) {
  function read(root, name, fallback = '') {
    const value = root.dataset[name];
    return typeof value === 'string' ? value : fallback;
  }

  function setOptionalId(element, id) {
    if (id) element.id = id;
  }

  function render(root) {
    if (!root || root.dataset.videoUploadBlockReady === 'true') return;
    root.dataset.videoUploadBlockReady = 'true';
    root.classList.add('upload-panel');

    const titleId = read(root, 'titleId', 'video-upload-title');
    root.setAttribute('aria-labelledby', titleId);

    const copy = document.createElement('div');
    copy.className = 'upload-copy';

    const eyebrow = document.createElement('p');
    eyebrow.className = 'eyebrow';
    eyebrow.textContent = read(root, 'eyebrow', 'Video');

    const title = document.createElement('h2');
    title.id = titleId;
    title.textContent = read(root, 'title', 'Upload video');

    const description = document.createElement('p');
    description.textContent = read(root, 'description');

    copy.append(eyebrow, title, description);

    const card = document.createElement('div');
    card.className = 'upload-card';

    const form = document.createElement('form');
    form.className = 'upload-form';
    setOptionalId(form, read(root, 'formId'));

    const inputId = read(root, 'inputId', 'videoInput');
    const picker = document.createElement('label');
    picker.className = 'file-picker';
    picker.setAttribute('for', inputId);

    const pickerTitle = document.createElement('span');
    pickerTitle.className = 'file-picker__title';
    pickerTitle.textContent = read(root, 'pickerTitle', 'Choose video');

    const pickerMeta = document.createElement('span');
    pickerMeta.className = 'file-picker__meta';
    setOptionalId(pickerMeta, read(root, 'metaId'));
    pickerMeta.textContent = read(root, 'pickerMeta');

    picker.append(pickerTitle, pickerMeta);

    const input = document.createElement('input');
    input.id = inputId;
    input.name = read(root, 'inputName', 'video');
    input.type = 'file';
    input.accept = read(root, 'accept', 'video/*');

    const button = document.createElement('button');
    button.className = 'primary-link upload-button';
    setOptionalId(button, read(root, 'buttonId'));
    button.type = read(root, 'buttonType', 'submit');
    button.textContent = read(root, 'buttonLabel', 'Upload');
    if (read(root, 'buttonDisabled') === 'true') button.disabled = true;

    form.append(picker, input, button);

    const progress = document.createElement('div');
    progress.className = 'progress';
    setOptionalId(progress, read(root, 'progressId'));
    progress.hidden = true;

    const progressBar = document.createElement('div');
    progressBar.className = 'progress-bar';
    setOptionalId(progressBar, read(root, 'progressBarId'));
    progress.append(progressBar);

    const status = document.createElement('p');
    status.className = 'upload-status';
    setOptionalId(status, read(root, 'statusId'));
    status.setAttribute('role', 'status');

    card.append(form, progress, status);
    root.replaceChildren(copy, card);
  }

  function renderAll() {
    document.querySelectorAll('[data-video-upload-block]').forEach(render);
  }

  global.VlandivirVideoUploadBlock = { render, renderAll };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderAll, { once: true });
  } else {
    renderAll();
  }
})(window);
