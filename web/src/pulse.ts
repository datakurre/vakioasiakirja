export interface PagePulseTracker {
  checkModified(pageSvgs: string[]): boolean[];
  reset(): void;
}

export function createPagePulseTracker(): PagePulseTracker {
  let prevPages: string[] | null = null;
  return {
    checkModified(pageSvgs: string[]): boolean[] {
      if (prevPages === null) {
        prevPages = [...pageSvgs];
        return pageSvgs.map(() => false);
      }
      const modified = pageSvgs.map(
        (svg, i) => prevPages![i] === undefined || prevPages![i] !== svg,
      );
      prevPages = [...pageSvgs];
      return modified;
    },
    reset() {
      prevPages = null;
    },
  };
}
