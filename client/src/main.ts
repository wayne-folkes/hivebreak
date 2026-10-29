import {
  Color,
  DirectionalLight,
  HemisphereLight,
  IcosahedronGeometry,
  Mesh,
  MeshToonMaterial,
  OrthographicCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { inject } from '@vercel/analytics';
import { injectSpeedInsights } from '@vercel/speed-insights';
import './style.css';
import { FIELD_HEIGHT, FIELD_WIDTH, fitPlayfield } from './game/playfield';

// Scaffold only: proves the low-resolution, whole-pixel render path end to end with a
// spinning placeholder. The game itself is built in slice 1 (docs/plan-slice-1.md).

inject();
injectSpeedInsights();

const container = document.getElementById('app')!;
// No antialiasing and a pixel ratio of 1: the canvas is the art resolution, and CSS scales it up.
const renderer = new WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(FIELD_WIDTH, FIELD_HEIGHT, false);
container.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color('#0b0820');
scene.add(new HemisphereLight('#8ab4ff', '#1a0f2e', 1.2));
const sun = new DirectionalLight('#ffffff', 2);
sun.position.set(-2, 4, 3);
scene.add(sun);

// One world unit is one art pixel; the camera tilts back a little so models show some depth.
const camera = new OrthographicCamera(-FIELD_WIDTH / 2, FIELD_WIDTH / 2, FIELD_HEIGHT / 2, -FIELD_HEIGHT / 2, 1, 1000);
camera.position.set(0, -120, 300);
camera.lookAt(0, 0, 0);

const placeholder = new Mesh(new IcosahedronGeometry(24, 0), new MeshToonMaterial({ color: '#ff4fd8' }));
scene.add(placeholder);

function layout(): void {
  const fit = fitPlayfield(window.innerWidth, window.innerHeight, window.devicePixelRatio);
  const style = renderer.domElement.style;
  style.width = `${fit.width}px`;
  style.height = `${fit.height}px`;
  style.left = `${fit.left}px`;
  style.top = `${fit.top}px`;
}
window.addEventListener('resize', layout);
layout();

renderer.setAnimationLoop((time) => {
  placeholder.rotation.set(time * 0.0007, time * 0.0011, 0);
  renderer.render(scene, camera);
});
