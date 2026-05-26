(function () {
  const INSTAGRAM_URL = 'https://www.instagram.com/vlandivir/';

  const COPY = {
    ru: {
      brand: 'vlandivir',
      navLabel: 'Навигация',
      langLabel: 'Выбор языка',
      home: 'Главная',
      subs: 'Subs',
      gpx: 'GPX',
      files: 'Ваши файлы',
      instagram: 'Instagram',
    },
    en: {
      brand: 'vlandivir',
      navLabel: 'Navigation',
      langLabel: 'Language',
      home: 'Home',
      subs: 'Subs',
      gpx: 'GPX',
      files: 'Files',
      instagram: 'Instagram',
    },
  };

  function currentLanguage() {
    return document.documentElement.lang?.toLowerCase().startsWith('en')
      ? 'en'
      : 'ru';
  }

  function pagePaths(lang) {
    return {
      home: lang === 'en' ? '/en' : '/',
      subs: lang === 'en' ? '/subs/en' : '/subs/',
      gpx: lang === 'en' ? '/gpx-route-png/en' : '/gpx-route-png/',
      files: '/files/',
    };
  }

  function makeLink({ href, text, active, external }) {
    const link = document.createElement('a');
    link.href = href;
    link.textContent = text;
    if (active) link.setAttribute('aria-current', 'page');
    if (external) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'v-site-header__external';
    }
    return link;
  }

  function renderHeader(mount) {
    const lang = currentLanguage();
    const copy = COPY[lang];
    const paths = pagePaths(lang);
    const active = mount.dataset.active || '';

    mount.className = 'v-site-header';

    const brand = makeLink({
      href: paths.home,
      text: '',
    });
    brand.className = 'v-site-header__brand';
    brand.setAttribute('aria-label', copy.brand);

    const mark = document.createElement('span');
    mark.className = 'v-site-header__mark';
    mark.textContent = 'VL';

    const name = document.createElement('span');
    name.className = 'v-site-header__name';
    name.textContent = copy.brand;
    brand.append(mark, name);

    const right = document.createElement('div');
    right.className = 'v-site-header__right';

    const nav = document.createElement('nav');
    nav.className = 'v-site-header__nav';
    nav.setAttribute('aria-label', copy.navLabel);
    nav.append(
      makeLink({ href: paths.home, text: copy.home, active: active === 'home' }),
      makeLink({ href: paths.subs, text: copy.subs, active: active === 'subs' }),
      makeLink({ href: paths.gpx, text: copy.gpx, active: active === 'gpx' }),
      makeLink({
        href: paths.files,
        text: copy.files,
        active: active === 'files',
      }),
      makeLink({
        href: INSTAGRAM_URL,
        text: copy.instagram,
        external: true,
      }),
    );

    const langNav = document.createElement('nav');
    langNav.className = 'v-site-header__lang';
    langNav.setAttribute('aria-label', copy.langLabel);
    langNav.append(
      makeLink({
        href: mount.dataset.langRu || '/',
        text: 'RU',
        active: lang === 'ru',
      }),
      makeLink({
        href: mount.dataset.langEn || '/en',
        text: 'EN',
        active: lang === 'en',
      }),
    );

    right.append(nav, langNav);
    mount.replaceChildren(brand, right);
  }

  document.querySelectorAll('[data-site-header]').forEach(renderHeader);
})();
