import * as THREE from 'three'
import { CSS3DRenderer, CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js'
import { CONFIG } from './config.js'
import { makeBitmapTextCanvas } from './bitmapfont.js'

export function createBillboard(scene) {
  const a = CONFIG.AD
  const hw = a.w / 2
  const hh = a.h / 2
  const group = new THREE.Group()
  group.position.set(a.x, a.y, a.z)
  const backMat = new THREE.MeshBasicMaterial({ color: 0x0c0c0c })
  const frameMat = new THREE.MeshBasicMaterial({ color: 0x2b2b2b })
  const headerMat = new THREE.MeshBasicMaterial({ color: 0x101010 })
  const box = (w, h, d, x, y, z, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
    m.position.set(x, y, z)
    group.add(m)
  }
  box(a.w + 2, a.h + 2, 1, 0, 0, 0, backMat)
  box(1, a.h + 2, 2, -(hw + 0.5), 0, 0.5, frameMat)
  box(1, a.h + 2, 2, hw + 0.5, 0, 0.5, frameMat)
  box(a.w + 2, 1, 2, 0, -(hh + 0.5), 0.5, frameMat)
  box(a.w + 2, 4, 2, 0, hh + 2, 0.5, headerMat)

  const label = makeBitmapTextCanvas('ADVERTISEMENT', 4, '#ffffff')
  const tex = new THREE.CanvasTexture(label)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.colorSpace = THREE.SRGBColorSpace
  const labelH = 3
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry((labelH * label.width) / label.height, labelH),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true })
  )
  plane.position.set(0, hh + 2, 1.53)
  group.add(plane)
  scene.add(group)

  const layer = document.getElementById('adLayer')
  const css = new CSS3DRenderer({ element: layer })
  const cssScene = new THREE.Scene()
  const adBox = document.createElement('div')
  adBox.style.width = a.width + 'px'
  adBox.style.height = a.height + 'px'
  adBox.style.backfaceVisibility = 'hidden'
  const adObject = new CSS3DObject(adBox)
  adObject.position.set(a.x, a.y, a.z + 0.55)
  adObject.scale.setScalar(a.w / a.width)
  cssScene.add(adObject)

  let started = false
  const start = () => {
    if (started) return
    if (!a.client || !a.slot) {
      if (!a.testImage) return
      started = true
      const img = document.createElement('img')
      img.src = a.testImage
      img.style.width = a.width + 'px'
      img.style.height = a.height + 'px'
      img.style.display = 'block'
      img.style.objectFit = 'fill'
      adBox.append(img)
      return
    }
    started = true
    const ins = document.createElement('ins')
    ins.className = 'adsbygoogle'
    ins.style.display = 'inline-block'
    ins.style.width = a.width + 'px'
    ins.style.height = a.height + 'px'
    ins.setAttribute('data-ad-client', a.client)
    ins.setAttribute('data-ad-slot', a.slot)
    adBox.append(ins)
    const s = document.createElement('script')
    s.async = true
    s.crossOrigin = 'anonymous'
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(a.client)}`
    document.head.append(s)
    ;(window.adsbygoogle = window.adsbygoogle || []).push({})
  }

  return {
    start,
    resize: (w, h) => css.setSize(w, h),
    render: (camera) => css.render(cssScene, camera)
  }
}
