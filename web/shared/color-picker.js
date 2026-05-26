(() => {
  'use strict';

  const DEFAULT_TEXT = {
    en: {
      doNotDraw: 'Do not draw',
      chooseColor: 'Choose color',
      shade: 'Shade',
      whiteAndBlack: 'white and black',
    },
    ru: {
      doNotDraw: 'Не рисовать',
      chooseColor: 'Выбрать цвет',
      shade: 'Оттенок',
      whiteAndBlack: 'белый и черный',
    },
  };

  function getDefaultBaseColors(isEn) {
    return [
      {
        name: isEn ? 'White and black' : 'Белый и черный',
        value: '#ffffff',
        split: true,
      },
      { name: isEn ? 'Yellow' : 'Желтый', value: '#eab308' },
      { name: isEn ? 'Warm' : 'Теплый', value: '#e07a5f' },
      { name: isEn ? 'Red' : 'Красный', value: '#ef4444' },
      { name: isEn ? 'Orange' : 'Оранжевый', value: '#f97316' },
      { name: isEn ? 'Green' : 'Зеленый', value: '#22c55e' },
      { name: isEn ? 'Blue' : 'Синий', value: '#3b82f6' },
      { name: isEn ? 'Purple' : 'Фиолетовый', value: '#8b5cf6' },
      { name: isEn ? 'Pink' : 'Розовый', value: '#ec4899' },
    ];
  }

  function isNoneColor(color) {
    return color === 'none';
  }

  function normalizeHex(value) {
    if (typeof value !== 'string') return '#ffffff';
    const color = value.trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(color) ? color : '#ffffff';
  }

  function hexToRgb(hex) {
    const normalized = normalizeHex(hex).replace('#', '');
    return [
      Number.parseInt(normalized.slice(0, 2), 16),
      Number.parseInt(normalized.slice(2, 4), 16),
      Number.parseInt(normalized.slice(4, 6), 16),
    ];
  }

  function rgbToHex([red, green, blue]) {
    return `#${[red, green, blue]
      .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
      .join('')}`;
  }

  function mixColor(color, target, amount) {
    const sourceRgb = hexToRgb(color);
    const targetRgb = hexToRgb(target);
    return rgbToHex(
      sourceRgb.map(
        (channel, index) => channel + (targetRgb[index] - channel) * amount,
      ),
    );
  }

  function isAchromaticColor(color) {
    const [red, green, blue] = hexToRgb(color);
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    return max - min < 24;
  }

  function getShades(baseColor) {
    const normalizedBase = normalizeHex(baseColor);

    if (normalizedBase === '#ffffff' || normalizedBase === '#000000') {
      return [
        '#ffffff',
        '#e0e0e0',
        '#c2c2c2',
        '#a3a3a3',
        '#858585',
        '#666666',
        '#474747',
        '#292929',
        '#000000',
      ];
    }

    if (normalizedBase === '#eab308') {
      return [
        '#fefce8',
        '#fef9c3',
        '#fef08a',
        '#fde047',
        '#facc15',
        '#eab308',
        '#ca8a04',
        '#a16207',
        '#713f12',
      ];
    }

    if (normalizedBase === '#e07a5f') {
      return [
        '#fff1eb',
        '#ffe0d4',
        '#ffcbb8',
        '#f5a88a',
        '#ec9274',
        '#e07a5f',
        '#c4614a',
        '#a34d3b',
        '#7d3a2d',
      ];
    }

    return [
      mixColor(normalizedBase, '#ffffff', 0.72),
      mixColor(normalizedBase, '#ffffff', 0.55),
      mixColor(normalizedBase, '#ffffff', 0.38),
      mixColor(normalizedBase, '#ffffff', 0.2),
      normalizedBase,
      mixColor(normalizedBase, '#000000', 0.16),
      mixColor(normalizedBase, '#000000', 0.32),
      mixColor(normalizedBase, '#000000', 0.48),
      mixColor(normalizedBase, '#000000', 0.64),
    ];
  }

  function findClosestBaseColor(color, baseColors) {
    if (!color || isNoneColor(color)) return baseColors[0];
    if (isAchromaticColor(color)) return baseColors[0];

    const rgb = hexToRgb(color);
    return baseColors.reduce(
      (closest, baseColor) => {
        const baseRgb = hexToRgb(baseColor.value);
        const distance = baseRgb.reduce((sum, channel, index) => {
          const delta = channel - rgb[index];
          return sum + delta * delta;
        }, 0);
        return distance < closest.distance ? { baseColor, distance } : closest;
      },
      { baseColor: baseColors[0], distance: Number.POSITIVE_INFINITY },
    ).baseColor;
  }

  function setColorInputValue(input, value) {
    input.value = value === 'none' ? 'none' : normalizeHex(value);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function closeColorPicker(pickerElement) {
    if (!pickerElement) return;
    pickerElement.classList.remove('is-open');
    pickerElement
      .querySelector('.color-picker__trigger')
      ?.setAttribute('aria-expanded', 'false');
  }

  function closeOtherColorPickers(activePicker) {
    document.querySelectorAll('.color-picker.is-open').forEach((picker) => {
      if (picker !== activePicker) {
        closeColorPicker(picker);
      }
    });
  }

  function closeAllColorPickers() {
    document.querySelectorAll('.color-picker.is-open').forEach(closeColorPicker);
  }

  function initialize(options = {}) {
    const isEn = document.documentElement.lang?.startsWith('en');
    const text = {
      ...DEFAULT_TEXT[isEn ? 'en' : 'ru'],
      ...(options.text || {}),
    };
    const baseColors = (options.baseColors || getDefaultBaseColors(isEn)).map(
      (color) => ({
        ...color,
        value: normalizeHex(color.value),
      }),
    );
    const root = options.root || document;
    const pickerElements = root.querySelectorAll('[data-color-picker]');

    for (const pickerElement of pickerElements) {
      const input = document.getElementById(pickerElement.dataset.colorPicker);
      if (!input) continue;

      pickerElement.textContent = '';
      pickerElement.classList.add('color-picker');
      pickerElement.dataset.colorPickerInitialized = 'true';

      const allowNone = pickerElement.dataset.allowNone === 'true';
      let selectedBase = findClosestBaseColor(input.value, baseColors);
      let keepSelectedBaseOnNextChange = false;

      const triggerButton = document.createElement('button');
      triggerButton.className = 'color-picker__trigger';
      triggerButton.type = 'button';
      triggerButton.setAttribute('aria-expanded', 'false');

      const selectedSwatch = document.createElement('span');
      selectedSwatch.className = 'color-picker__selected-swatch';

      const selectedLabel = document.createElement('span');
      selectedLabel.className = 'color-picker__selected-label';

      triggerButton.append(selectedSwatch, selectedLabel);

      const panel = document.createElement('div');
      panel.className = 'color-picker__panel';

      const baseGrid = document.createElement('div');
      baseGrid.className = 'color-picker__grid';

      const shadeGrid = document.createElement('div');
      shadeGrid.className = 'color-picker__grid color-picker__grid--shades';

      const resetButton = document.createElement('button');
      resetButton.className = 'color-picker__reset';
      resetButton.type = 'button';
      resetButton.title = text.doNotDraw;
      resetButton.setAttribute('aria-label', text.doNotDraw);
      resetButton.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      `;
      resetButton.addEventListener('click', (event) => {
        event.stopPropagation();
        setColorInputValue(input, 'none');
        renderPicker();
      });

      panel.append(baseGrid, shadeGrid);
      if (allowNone) {
        const pickerRow = document.createElement('div');
        pickerRow.className = 'color-picker__row';
        pickerRow.append(triggerButton, resetButton);
        pickerElement.append(pickerRow, panel);
      } else {
        pickerElement.append(triggerButton, panel);
      }

      triggerButton.addEventListener('click', (event) => {
        event.stopPropagation();
        closeOtherColorPickers(pickerElement);
        pickerElement.classList.add('is-open');
        triggerButton.setAttribute('aria-expanded', 'true');
      });

      pickerElement.addEventListener('click', (event) => {
        event.stopPropagation();
      });

      function renderButton(color, label, onClick, isActive, buttonOptions = {}) {
        const button = document.createElement('button');
        button.className = 'color-picker__swatch';
        button.type = 'button';
        button.title = buttonOptions.split
          ? `${label} — ${text.whiteAndBlack}`
          : label;
        button.setAttribute('aria-label', label);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        if (buttonOptions.split) {
          button.classList.add('color-picker__swatch--split');
        } else {
          button.style.background = color;
        }
        if (isActive) button.classList.add('is-active');
        if (buttonOptions.familyActive) button.classList.add('is-family-active');
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          onClick();
        });
        button.addEventListener('dblclick', (event) => {
          event.stopPropagation();
          event.preventDefault();
          onClick();
          closeColorPicker(pickerElement);
        });
        return button;
      }

      function renderPicker() {
        const value = input.value === 'none' ? 'none' : normalizeHex(input.value);
        const isNone = isNoneColor(value);
        const shades = getShades(selectedBase.value);

        selectedSwatch.style.background = isNone ? 'transparent' : value;
        selectedSwatch.classList.toggle('is-none', isNone);
        selectedLabel.textContent = isNone
          ? text.doNotDraw.toLowerCase()
          : value.toUpperCase();
        triggerButton.setAttribute(
          'aria-label',
          `${text.chooseColor}: ${selectedLabel.textContent}`,
        );
        resetButton.classList.toggle('is-active', isNone);

        baseGrid.replaceChildren(
          ...baseColors.map((baseColor) =>
            renderButton(
              baseColor.value,
              baseColor.name,
              () => {
                selectedBase = baseColor;
                keepSelectedBaseOnNextChange = true;
                setColorInputValue(input, baseColor.value);
                renderPicker();
              },
              !isNone && value === baseColor.value,
              {
                split: baseColor.split,
                familyActive: !isNone && selectedBase.value === baseColor.value,
              },
            ),
          ),
        );

        shadeGrid.replaceChildren(
          ...shades.map((shade, index) =>
            renderButton(
              shade,
              `${text.shade} ${index + 1}`,
              () => {
                keepSelectedBaseOnNextChange = true;
                setColorInputValue(input, shade);
                renderPicker();
              },
              !isNone && value === shade,
            ),
          ),
        );
      }

      input.addEventListener('change', () => {
        if (keepSelectedBaseOnNextChange) {
          keepSelectedBaseOnNextChange = false;
        } else {
          selectedBase = findClosestBaseColor(input.value, baseColors);
        }
        renderPicker();
      });
      renderPicker();
    }

    if (!document.documentElement.dataset.colorPickerCloseListener) {
      document.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest('.color-picker')) return;
        closeAllColorPickers();
      });
      document.documentElement.dataset.colorPickerCloseListener = 'true';
    }
  }

  window.VlandivirColorPicker = {
    closeAll: closeAllColorPickers,
    initialize,
    isNoneColor,
    setColorInputValue,
  };
})();
