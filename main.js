/* =========================================================
   Haidar — portfolio motion
   Techniques used:
   - Intro curtain with counter, clip-path wipe
   - Character rise for the hero name, arch "growing" from the floor
   - 2.5D depth: mouse parallax + scroll parallax per depth layer
   - Typewriter role, brass shine sweep on the credential plate
   - Velocity-reactive marquee (speed, direction and skew follow the scroll)
   - Word-by-word scroll lighting (statement)
   - Pinned horizontal gallery with inner parallax (desktop)
   - Masked line reveals for headings
   - Timeline line drawn by scroll, dots that light up
   - Elastic chip stagger, 3D tilt on project visuals
   - Circle iris reveal for the contact section
   - Magnetic buttons, custom cursor, scroll progress, scramble nav links
   Everything is skipped for prefers-reduced-motion or if GSAP fails to load;
   the page is fully readable without it.
   ========================================================= */
(function () {
  'use strict';

  var root = document.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ---------------------------------------------------------
     Basics (always on)
     --------------------------------------------------------- */
  var year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  // Theme toggle: explicit choice overrides the system preference
  var themeBtn = document.querySelector('.theme-toggle');
  function currentTheme() {
    if (root.dataset.theme) return root.dataset.theme;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem('theme', next); } catch (e) {}
    });
  }

  // Mobile menu
  var toggle = document.querySelector('.nav__toggle');
  var links = document.getElementById('nav-links');
  function closeMenu() {
    toggle.setAttribute('aria-expanded', 'false');
    links.classList.remove('is-open');
  }
  if (toggle && links) {
    toggle.addEventListener('click', function () {
      var open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      links.classList.toggle('is-open', !open);
    });
    links.addEventListener('click', function (e) { if (e.target.closest('a')) closeMenu(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });
  }

  // Header: solid after leaving the top, hides on scroll down, returns on scroll up
  var header = document.querySelector('.site-header');
  var lastY = window.scrollY;
  function onScrollHeader() {
    var y = window.scrollY;
    header.classList.toggle('is-scrolled', y > 20);
    var menuOpen = links && links.classList.contains('is-open');
    header.classList.toggle('is-hidden', !menuOpen && y > lastY && y > window.innerHeight * 0.8);
    lastY = y;
  }
  window.addEventListener('scroll', onScrollHeader, { passive: true });
  onScrollHeader();

  // Highlight the nav link for the section in view
  var navLinks = Array.prototype.slice.call(document.querySelectorAll('.nav__links a[href^="#"]'));
  if ('IntersectionObserver' in window && navLinks.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        navLinks.forEach(function (a) {
          a.classList.toggle('is-active', a.getAttribute('href') === '#' + entry.target.id);
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    navLinks.forEach(function (a) {
      var s = document.querySelector(a.getAttribute('href'));
      if (s) io.observe(s);
    });
  }

  var loader = document.querySelector('.loader');
  function removeLoader() { if (loader && loader.parentNode) loader.parentNode.removeChild(loader); }

  if (reduceMotion || !window.gsap || !window.ScrollTrigger) {
    removeLoader();
    return;
  }

  /* ---------------------------------------------------------
     Motion setup
     --------------------------------------------------------- */
  var gsap = window.gsap;
  var ScrollTrigger = window.ScrollTrigger;
  gsap.registerPlugin(ScrollTrigger);
  root.classList.add('js-motion');

  // Smooth scrolling (Lenis), driven by GSAP's ticker so ScrollTrigger stays in sync
  var lenis = null;
  if (window.Lenis) {
    lenis = new window.Lenis({ lerp: 0.1, smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
    gsap.ticker.lagSmoothing(0);
    lenis.stop(); // held until the intro finishes
  }

  // In-page links go through Lenis so they glide
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href^="#"]');
    if (!a) return;
    var id = a.getAttribute('href');
    if (id.length < 2) return;
    var target = document.querySelector(id);
    if (!target) return;
    e.preventDefault();
    if (lenis) lenis.scrollTo(target, { offset: id === '#top' ? 0 : -60, duration: 1.4 });
    else target.scrollIntoView({ behavior: 'smooth' });
    if (history.replaceState) history.replaceState(null, '', id);
  });

  /* ---------- Text splitting helpers ---------- */
  function splitChars(el) {
    var text = el.textContent;
    el.textContent = '';
    return text.split('').map(function (c) {
      var s = document.createElement('span');
      s.className = 'char';
      s.setAttribute('aria-hidden', 'true');
      s.textContent = c === ' ' ? ' ' : c;
      el.appendChild(s);
      return s;
    });
  }

  function splitWords(el, masked) {
    var words = el.textContent.trim().split(/\s+/);
    el.textContent = '';
    return words.map(function (w, i) {
      var outer = document.createElement('span');
      outer.className = 'word';
      var target = outer;
      if (masked) {
        outer.style.overflow = 'hidden';
        outer.style.verticalAlign = 'top';
        outer.style.paddingBottom = '.08em';
        var inner = document.createElement('span');
        inner.style.display = 'inline-block';
        inner.textContent = w;
        outer.appendChild(inner);
        target = inner;
      } else {
        outer.textContent = w;
      }
      el.appendChild(outer);
      if (i < words.length - 1) el.appendChild(document.createTextNode(' '));
      return target;
    });
  }

  function maskLines(el) {
    var inner = document.createElement('span');
    while (el.firstChild) inner.appendChild(el.firstChild);
    var mask = document.createElement('span');
    mask.className = 'line-mask';
    mask.appendChild(inner);
    el.appendChild(mask);
    return inner;
  }

  /* ---------------------------------------------------------
     Intro: counter → curtain wipe → hero entrance
     --------------------------------------------------------- */
  var nameChars = splitChars(document.querySelector('.hero__name-inner'));
  var arch = document.querySelector('.hero__arch');
  var figure = document.querySelector('.hero__figure');
  var plate = document.querySelector('.plate');
  var shine = document.createElement('span');
  shine.className = 'plate__shine';
  shine.setAttribute('aria-hidden', 'true');
  plate.appendChild(shine);

  var roleEl = document.querySelector('[data-type]');
  var roleText = roleEl.getAttribute('data-type');
  roleEl.textContent = '';

  gsap.set(arch, { scaleY: 0, transformOrigin: '50% 100%' });
  gsap.set(nameChars, { yPercent: 115, opacity: 0 });
  gsap.set(figure, { yPercent: 18, opacity: 0, scale: 0.94 });
  gsap.set(plate, { opacity: 0, x: -40 });
  gsap.set(['.hero__intro', '.hero__actions .btn', '.scroll-cue'], { opacity: 0, y: 24 });
  gsap.set(['.hero__grid', '.hero__glow'], { opacity: 0 });

  var intro = gsap.timeline({ defaults: { ease: 'expo.out' } });

  if (loader) {
    loader.style.animation = 'none'; // JS is in charge; cancel the CSS fallback
    gsap.set(loader, { clipPath: 'inset(0 0 0% 0)' });
    var counter = { v: 0 };
    var num = loader.querySelector('.loader__num');
    intro
      .to(counter, {
        v: 100, duration: 1.1, ease: 'power2.inOut',
        onUpdate: function () { num.textContent = Math.round(counter.v); }
      })
      .to('.loader__bar', { scaleX: 1, duration: 1.1, ease: 'power2.inOut' }, 0)
      .to('.loader__inner', { yPercent: -40, opacity: 0, duration: 0.5, ease: 'power3.in' }, '+=0.05')
      .to(loader, { clipPath: 'inset(0 0 100% 0)', duration: 0.9, ease: 'expo.inOut', onComplete: removeLoader }, '-=0.15')
      .addLabel('hero', '-=0.45');
  } else {
    intro.addLabel('hero', 0);
  }

  intro
    .to(['.hero__grid', '.hero__glow'], { opacity: 1, duration: 1.6, ease: 'power2.out' }, 'hero')
    .to(arch, { scaleY: 1, duration: 1.3 }, 'hero')
    .to(nameChars, { yPercent: 0, opacity: 1, duration: 1.2, stagger: 0.06 }, 'hero+=0.1')
    .to(figure, { yPercent: 0, opacity: 1, scale: 1, duration: 1.5 }, 'hero+=0.3')
    .to(plate, { opacity: 1, x: 0, duration: 1 }, 'hero+=0.8')
    .fromTo(shine, { xPercent: -120 }, { xPercent: 120, duration: 1.2, ease: 'power2.inOut' }, 'hero+=1.3')
    .add(typeRole, 'hero+=0.7')
    .to('.hero__intro', { opacity: 1, y: 0, duration: 1 }, 'hero+=0.9')
    .to('.hero__actions .btn', { opacity: 1, y: 0, duration: 0.9, stagger: 0.1 }, 'hero+=1.0')
    .to('.scroll-cue', { opacity: 1, y: 0, duration: 0.8 }, 'hero+=1.3')
    .add(function () { if (lenis) lenis.start(); }, 'hero+=0.6')
    .add(heroMouse);

  function typeRole() {
    var i = 0;
    var t = setInterval(function () {
      i++;
      roleEl.textContent = roleText.slice(0, i);
      if (i >= roleText.length) clearInterval(t);
    }, 55);
  }

  // Brass shine repeats every few seconds while the hero is visible
  gsap.timeline({ repeat: -1, repeatDelay: 5, delay: 6 })
    .fromTo(shine, { xPercent: -120 }, { xPercent: 120, duration: 1.2, ease: 'power2.inOut' });

  /* ---------- Hero scroll parallax (depth-based speeds) ---------- */
  var heroScroll = { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true };
  gsap.to('.hero__grid', { yPercent: 20, ease: 'none', scrollTrigger: heroScroll });
  gsap.to('.hero__arch-pos', { y: function () { return window.innerHeight * 0.18; }, ease: 'none', scrollTrigger: heroScroll });
  gsap.to('.hero__figure-pos', { y: function () { return window.innerHeight * 0.06; }, ease: 'none', scrollTrigger: heroScroll });
  gsap.to('.hero__name-inner', { y: function () { return window.innerHeight * 0.3; }, opacity: 0.1, ease: 'none', scrollTrigger: heroScroll });
  // Letters drift apart as you leave the hero
  gsap.to(nameChars, {
    x: function (i) { return (i - (nameChars.length - 1) / 2) * window.innerWidth * 0.03; },
    ease: 'none',
    scrollTrigger: heroScroll
  });
  gsap.to('.hero__copy', { y: function () { return -window.innerHeight * 0.12; }, opacity: 0, ease: 'none',
    scrollTrigger: { trigger: '.hero', start: 'top top', end: '60% top', scrub: true } });
  gsap.to('.plate', { yPercent: -80, ease: 'none', scrollTrigger: heroScroll });

  /* ---------- Hero mouse parallax (desktop only) ---------- */
  function heroMouse() {
    if (!finePointer) return;
    var hero = document.querySelector('.hero');
    var layers = [
      { el: '.hero__grid', d: -6 },
      { el: '.hero__glow', d: 30 },
      { el: '.hero__arch-pos', d: 10 },
      { el: '.hero__name', d: -22 },
      { el: '.hero__figure-pos', d: 18 },
      { el: '.plate', d: 34 }
    ].map(function (l) {
      var node = document.querySelector(l.el);
      return {
        d: l.d,
        x: gsap.quickTo(node, 'x', { duration: 1.2, ease: 'power3.out' }),
        y: gsap.quickTo(node, 'y', { duration: 1.2, ease: 'power3.out' }),
        el: node
      };
    });
    // The plate and arch/figure wrappers also get scroll tweens on other props, so
    // mouse parallax only uses x here for those, and a tilt on the figure.
    var tilt = gsap.quickTo(figure, 'rotation', { duration: 1.2, ease: 'power3.out' });
    hero.addEventListener('mousemove', function (e) {
      var nx = e.clientX / window.innerWidth - 0.5;
      var ny = e.clientY / window.innerHeight - 0.5;
      layers.forEach(function (l) {
        l.x(nx * l.d);
        if (l.el.matches('.hero__grid, .hero__glow, .hero__name')) l.y(ny * l.d);
      });
      tilt(nx * 1.5);
    });
    hero.addEventListener('mouseleave', function () {
      layers.forEach(function (l) { l.x(0); if (l.el.matches('.hero__grid, .hero__glow, .hero__name')) l.y(0); });
      tilt(0);
    });
  }

  /* ---------------------------------------------------------
     Scroll progress
     --------------------------------------------------------- */
  gsap.to('.progress', {
    scaleX: 1, ease: 'none',
    scrollTrigger: { start: 0, end: 'max', scrub: 0.3 }
  });

  /* ---------------------------------------------------------
     Velocity-reactive marquee
     --------------------------------------------------------- */
  var track = document.querySelector('.marquee__track');
  var lists = document.querySelectorAll('.marquee__list');
  var marqueeAnim = track && track.getAnimations ? track.getAnimations()[0] : null;
  if (marqueeAnim) {
    var dir = 1, boost = 0, rate = 1;
    var skew = gsap.quickTo(lists, 'skewX', { duration: 0.5, ease: 'power3.out' });
    ScrollTrigger.create({
      trigger: '.marquee', start: 'top bottom', end: 'bottom top',
      onUpdate: function (self) {
        var v = self.getVelocity();
        dir = v < 0 ? -1 : 1;
        boost = Math.min(Math.abs(v) / 250, 8);
        skew(gsap.utils.clamp(-12, 12, -v / 250));
      }
    });
    gsap.ticker.add(function () {
      boost *= 0.92;
      rate += ((1 + boost) * dir - rate) * 0.1;
      marqueeAnim.playbackRate = rate;
      if (boost < 0.05) skew(0);
    });
  }

  /* ---------------------------------------------------------
     Statement: words light up as you scroll
     --------------------------------------------------------- */
  var statement = document.querySelector('.statement__text');
  var words = splitWords(statement, false);
  gsap.fromTo(words, { opacity: 0.14 }, {
    opacity: 1, stagger: 0.1, ease: 'none',
    scrollTrigger: { trigger: statement, start: 'top 80%', end: 'bottom 45%', scrub: true }
  });
  gsap.from('.facts > div', {
    y: 40, opacity: 0, duration: 1, stagger: 0.1, ease: 'expo.out',
    scrollTrigger: { trigger: '.facts', start: 'top 88%' }
  });

  /* ---------------------------------------------------------
     Section titles: masked line reveal
     --------------------------------------------------------- */
  document.querySelectorAll('[data-reveal="lines"]').forEach(function (title) {
    var inner = maskLines(title);
    gsap.from(inner, {
      yPercent: 110, rotate: 2, duration: 1.2, ease: 'expo.out',
      scrollTrigger: { trigger: title, start: 'top 88%' }
    });
  });

  /* ---------------------------------------------------------
     Work: pinned horizontal gallery on desktop, reveals elsewhere
     --------------------------------------------------------- */
  var mm = gsap.matchMedia();

  mm.add('(min-width: 1024px) and (hover: hover) and (pointer: fine)', function () {
    root.classList.add('h-scroll');
    var trackEl = document.querySelector('.work__track');
    function distance() { return trackEl.scrollWidth - window.innerWidth; }

    var horizontal = gsap.to(trackEl, {
      x: function () { return -distance(); },
      ease: 'none',
      scrollTrigger: {
        trigger: '.work',
        start: 'top top',
        end: function () { return '+=' + distance(); },
        pin: true,
        scrub: 1,
        invalidateOnRefresh: true,
        anticipatePin: 1
      }
    });

    // Inside the gallery: mock UI drifts against the motion, text slides in
    document.querySelectorAll('.work .project').forEach(function (p) {
      gsap.fromTo(p.querySelector('.mock'), { xPercent: 18, rotate: 3 }, {
        xPercent: -18, rotate: -3, ease: 'none',
        scrollTrigger: { trigger: p, containerAnimation: horizontal, start: 'left right', end: 'right left', scrub: true }
      });
      gsap.from(p.querySelectorAll('.project__body > *'), {
        x: 80, opacity: 0, duration: 1, stagger: 0.06, ease: 'expo.out',
        scrollTrigger: { trigger: p, containerAnimation: horizontal, start: 'left 75%' }
      });
      gsap.fromTo(p.querySelector('.project__visual'), { clipPath: 'inset(0% 100% 0% 0% round 20px)' }, {
        clipPath: 'inset(0% 0% 0% 0% round 20px)', duration: 1.3, ease: 'expo.inOut',
        scrollTrigger: { trigger: p, containerAnimation: horizontal, start: 'left 85%' }
      });
    });

    ScrollTrigger.refresh();
    return function () { root.classList.remove('h-scroll'); };
  });

  mm.add('not ((min-width: 1024px) and (hover: hover) and (pointer: fine))', function () {
    document.querySelectorAll('.work .project').forEach(function (p) {
      gsap.fromTo(p.querySelector('.project__visual'), { clipPath: 'inset(100% 0% 0% 0% round 20px)' }, {
        clipPath: 'inset(0% 0% 0% 0% round 20px)', duration: 1.3, ease: 'expo.inOut',
        scrollTrigger: { trigger: p, start: 'top 85%' }
      });
      gsap.from(p.querySelectorAll('.project__body > *'), {
        y: 40, opacity: 0, duration: 1, stagger: 0.06, ease: 'expo.out',
        scrollTrigger: { trigger: p.querySelector('.project__body'), start: 'top 88%' }
      });
    });
  });

  // 3D tilt on project visuals (desktop)
  if (finePointer) {
    document.querySelectorAll('.project__visual').forEach(function (v) {
      gsap.set(v, { transformPerspective: 900 });
      var rx = gsap.quickTo(v, 'rotationX', { duration: 0.6, ease: 'power3.out' });
      var ry = gsap.quickTo(v, 'rotationY', { duration: 0.6, ease: 'power3.out' });
      v.addEventListener('mousemove', function (e) {
        var r = v.getBoundingClientRect();
        ry(((e.clientX - r.left) / r.width - 0.5) * 12);
        rx(-((e.clientY - r.top) / r.height - 0.5) * 12);
      });
      v.addEventListener('mouseleave', function () { rx(0); ry(0); });
    });
  }

  /* ---------------------------------------------------------
     Timeline: line draws with scroll, dots light up
     --------------------------------------------------------- */
  gsap.to('.timeline__line span', {
    scaleY: 1, ease: 'none',
    scrollTrigger: { trigger: '.timeline', start: 'top 70%', end: 'bottom 70%', scrub: true }
  });
  document.querySelectorAll('.timeline__item').forEach(function (item) {
    gsap.from(item.children, {
      x: 60, opacity: 0, duration: 1.1, stagger: 0.08, ease: 'expo.out',
      scrollTrigger: { trigger: item, start: 'top 85%' }
    });
    ScrollTrigger.create({
      trigger: item, start: 'top 70%',
      onEnter: function () { item.classList.add('is-lit'); },
      onLeaveBack: function () { item.classList.remove('is-lit'); }
    });
  });

  /* ---------------------------------------------------------
     Skills: elastic chip stagger
     --------------------------------------------------------- */
  document.querySelectorAll('.skills__group').forEach(function (g) {
    var tl = gsap.timeline({ scrollTrigger: { trigger: g, start: 'top 85%' } });
    tl.from(g.querySelector('h3'), { y: 30, opacity: 0, duration: 0.8, ease: 'expo.out' })
      .from(g.querySelectorAll('.chips li'), {
        scale: 0.4, y: 30, opacity: 0, duration: 0.9, stagger: 0.05, ease: 'back.out(2.2)'
      }, '-=0.5');
  });

  /* ---------------------------------------------------------
     Contact: circle iris opens from the bottom, headline rises
     --------------------------------------------------------- */
  gsap.fromTo('.contact',
    { clipPath: 'circle(12% at 50% 100%)' },
    { clipPath: 'circle(150% at 50% 100%)', ease: 'none',
      scrollTrigger: { trigger: '.contact', start: 'top bottom', end: 'bottom bottom', scrub: true } });

  var contactWords = splitWords(document.querySelector('.contact__title'), true);
  var contactTl = gsap.timeline({ scrollTrigger: { trigger: '.contact__title', start: 'top 80%' } });
  contactTl
    .from(contactWords, { yPercent: 110, rotate: 4, duration: 1.1, stagger: 0.05, ease: 'expo.out' })
    .from('.contact__lead', { y: 30, opacity: 0, duration: 1, ease: 'expo.out' }, '-=0.7')
    .from('.contact__actions .btn', { scale: 0.6, opacity: 0, duration: 1.2, ease: 'elastic.out(1, 0.55)' }, '-=0.7')
    .from('.contact__links li', { y: 20, opacity: 0, duration: 0.8, stagger: 0.08, ease: 'expo.out' }, '-=0.9');

  /* ---------------------------------------------------------
     Magnetic buttons + custom cursor (desktop)
     --------------------------------------------------------- */
  if (finePointer) {
    document.querySelectorAll('[data-magnetic]').forEach(function (el) {
      var mx = gsap.quickTo(el, 'x', { duration: 0.5, ease: 'power3.out' });
      var my = gsap.quickTo(el, 'y', { duration: 0.5, ease: 'power3.out' });
      el.addEventListener('mousemove', function (e) {
        var r = el.getBoundingClientRect();
        mx((e.clientX - (r.left + r.width / 2)) * 0.35);
        my((e.clientY - (r.top + r.height / 2)) * 0.35);
      });
      el.addEventListener('mouseleave', function () {
        gsap.to(el, { x: 0, y: 0, duration: 1, ease: 'elastic.out(1, 0.4)' });
      });
    });

    root.classList.add('has-cursor');
    var cursor = document.querySelector('.cursor');
    var dot = cursor.querySelector('.cursor__dot');
    var ring = cursor.querySelector('.cursor__ring');
    var dx = gsap.quickTo(dot, 'x', { duration: 0.1 });
    var dy = gsap.quickTo(dot, 'y', { duration: 0.1 });
    var rxq = gsap.quickTo(ring, 'x', { duration: 0.5, ease: 'power3.out' });
    var ryq = gsap.quickTo(ring, 'y', { duration: 0.5, ease: 'power3.out' });
    gsap.set([dot, ring], { opacity: 0 });
    window.addEventListener('mousemove', function (e) {
      gsap.to([dot, ring], { opacity: 1, duration: 0.3, overwrite: 'auto' });
      dx(e.clientX); dy(e.clientY); rxq(e.clientX); ryq(e.clientY);
      cursor.classList.toggle('is-hover', !!e.target.closest('a, button, .project__visual, .chips li'));
    });
    document.addEventListener('mouseleave', function () { gsap.to([dot, ring], { opacity: 0, duration: 0.3 }); });
    window.addEventListener('mousedown', function () { cursor.classList.add('is-down'); });
    window.addEventListener('mouseup', function () { cursor.classList.remove('is-down'); });
  }

  /* ---------------------------------------------------------
     Scramble effect on nav links
     --------------------------------------------------------- */
  var glyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#%&*+=<>/';
  document.querySelectorAll('[data-scramble]').forEach(function (a) {
    var original = a.textContent;
    var running = false;
    a.addEventListener('mouseenter', function () {
      if (running) return;
      running = true;
      var frame = 0;
      var total = original.length * 3;
      var id = setInterval(function () {
        frame++;
        a.textContent = original.split('').map(function (c, i) {
          return i < frame / 3 ? c : glyphs[Math.floor(Math.random() * glyphs.length)];
        }).join('');
        if (frame >= total) { clearInterval(id); a.textContent = original; running = false; }
      }, 28);
    });
  });

  // Re-measure once web fonts and images have settled
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { ScrollTrigger.refresh(); });
  window.addEventListener('load', function () { ScrollTrigger.refresh(); });
})();
