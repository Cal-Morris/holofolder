/** One shared loader, so the idle warm-up fetches the same chunk the 3D view renders from. */
export const loadViewport = () => import('@/components/binder-designer/viewport');
