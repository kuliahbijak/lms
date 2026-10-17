/* SIAKAD SISWA v3.2 — tema.js : mode terang/gelap & warna tema (disimpan per perangkat).
   Dimuat paling awal di <head> (tanpa defer, ±1 KB) agar halaman tidak "berkedip" putih saat mode gelap. */
(function () {
  'use strict';
  var KUNCI = 'siakad_tema';
  var WARNA = { sekolah: null, navy: ['#1E3A5F', 'Navy Akademik'], biru: ['#1D4ED8', 'Biru Samudra'], hijau: ['#0F766E', 'Hijau Toska'], ungu: ['#6D28D9', 'Ungu Anggrek'],
    marun: ['#9F1239', 'Merah Marun'], jingga: ['#C2410C', 'Jingga Senja'], grafit: ['#334155', 'Abu Grafit'] };
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function baca() { try { return JSON.parse(localStorage.getItem(KUNCI) || '{}') || {}; } catch (e) { return {}; } }
  function terapkan(t) {
    t = t || baca();
    var mode = t.mode || 'terang', gelap = mode === 'gelap' || (mode === 'sistem' && !!(mq && mq.matches)), el = document.documentElement;
    el.setAttribute('data-mode', gelap ? 'gelap' : 'terang');
    if (t.warna && WARNA[t.warna]) el.setAttribute('data-warna', t.warna); else el.removeAttribute('data-warna');
    el.style.colorScheme = gelap ? 'dark' : 'light';
  }
  window.Tema = {
    WARNA: WARNA,
    get: baca,
    set: function (ubah) { var t = baca(); for (var k in ubah) t[k] = ubah[k]; try { localStorage.setItem(KUNCI, JSON.stringify(t)); } catch (e) {} terapkan(t); return t; },
    terapkan: terapkan,
    gelap: function () { return document.documentElement.getAttribute('data-mode') === 'gelap'; }
  };
  terapkan();
  if (mq) { var ubah = function () { if ((baca().mode || 'terang') === 'sistem') terapkan(); }; if (mq.addEventListener) mq.addEventListener('change', ubah); else if (mq.addListener) mq.addListener(ubah); }
})();
