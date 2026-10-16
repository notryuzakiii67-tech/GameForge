"use client";

import { useEffect, useRef, useState } from "react";
import {
  AnimationMixer, Box3, Clock, Color, DirectionalLight, GridHelper, HemisphereLight,
  PerspectiveCamera, Scene, Vector3, WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export function AssetPreview({ url, label }: { url: string; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "low-power" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setClearColor(new Color("#10171e"));
    } catch {
      setLoading(false);
      setError("This browser or device could not create a WebGL preview. The validated file remains private and downloadable from your library.");
      return;
    }

    const scene = new Scene();
    scene.background = new Color("#10171e");
    const camera = new PerspectiveCamera(42, 1, 0.01, 100_000);
    camera.position.set(4, 3, 5);
    scene.add(new HemisphereLight(0xddeeff, 0x282018, 2.2));
    const keyLight = new DirectionalLight(0xffffff, 2.3);
    keyLight.position.set(4, 8, 5);
    scene.add(keyLight);
    const fillLight = new DirectionalLight(0x88aaff, 0.8);
    fillLight.position.set(-5, 2, -4);
    scene.add(fillLight);
    const grid = new GridHelper(10, 20, 0x405362, 0x263641);
    scene.add(grid);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.8;
    controls.minDistance = 0.05;
    controls.maxDistance = 100_000;
    const clock = new Clock();
    const loader = new GLTFLoader();
    let mixer: AnimationMixer | null = null;
    let animationFrame = 0;
    let disposed = false;

    const resize = () => {
      const width = Math.max(canvas.clientWidth, 1);
      const height = Math.max(canvas.clientHeight, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    loader.load(url, (gltf) => {
      if (disposed) return;
      const model = gltf.scene;
      scene.add(model);
      const bounds = new Box3().setFromObject(model);
      const center = bounds.getCenter(new Vector3());
      const size = bounds.getSize(new Vector3());
      model.position.sub(center);
      const maxDimension = Math.max(size.x, size.y, size.z, 0.1);
      const distance = maxDimension * 1.8;
      camera.near = Math.max(maxDimension / 1000, 0.001);
      camera.far = Math.max(maxDimension * 100, 100);
      camera.position.set(distance, distance * 0.72, distance);
      camera.updateProjectionMatrix();
      controls.target.set(0, 0, 0);
      controls.minDistance = maxDimension * 0.15;
      controls.maxDistance = maxDimension * 30;
      if (gltf.animations.length) {
        mixer = new AnimationMixer(model);
        for (const clip of gltf.animations.slice(0, 20)) mixer.clipAction(clip).play();
      }
      setLoading(false);
    }, undefined, () => {
      if (!disposed) {
        setLoading(false);
        setError("The validated model could not be rendered in this browser. No external model resources are allowed.");
      }
    });

    const render = () => {
      animationFrame = window.requestAnimationFrame(render);
      if (mixer) mixer.update(Math.min(clock.getDelta(), 0.05));
      controls.update();
      renderer.render(scene, camera);
    };
    render();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
      controls.dispose();
      mixer?.stopAllAction();
      scene.traverse((object) => {
        const drawable = object as typeof object & { geometry?: { dispose: () => void }; material?: unknown };
        drawable.geometry?.dispose();
        if (Array.isArray(drawable.material)) drawable.material.forEach((material) => (material as { dispose?: () => void }).dispose?.());
        else (drawable.material as { dispose?: () => void } | undefined)?.dispose?.();
      });
      renderer.dispose();
    };
  }, [url]);

  return <div className="asset-model-preview" aria-label={`3D preview of ${label}`}>
    <canvas ref={canvasRef} />
    {loading && <div className="asset-preview-overlay">Loading private model…</div>}
    {error && <div className="asset-preview-error" role="status">{error}</div>}
    {!error && !loading && <span className="asset-preview-hint">Drag to rotate · scroll to zoom</span>}
  </div>;
}
