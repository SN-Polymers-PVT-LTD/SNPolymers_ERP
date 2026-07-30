/**
 * Donut Arc Geometry Calculations
 * Consolidates SVG path calculations for donut chart slices.
 */

export const buildDonutSlices = (items = [], outerRadius = 85, innerRadius = 55, center = 100) => {
  if (!items || !Array.isArray(items) || items.length === 0) {
    return [];
  }

  const totalAmount = items.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  let currentCumulativeAngle = 0;

  return items.map((slice) => {
    const amountNum = Number(slice.amount) || 0;
    const pct = totalAmount > 0 ? (amountNum / totalAmount) * 100 : (Number(slice.percentage) || 0);
    const angle = (pct / 100) * 360;
    const startAngle = currentCumulativeAngle;
    const endAngle = currentCumulativeAngle + angle;
    currentCumulativeAngle += angle;

    if (angle >= 359.9) {
      const fullCirclePathData = `M ${center} ${center - outerRadius} A ${outerRadius} ${outerRadius} 0 1 1 ${center - 0.01} ${center - outerRadius} L ${center - 0.01} ${center - innerRadius} A ${innerRadius} ${innerRadius} 0 1 0 ${center} ${center - innerRadius} Z`;
      return {
        ...slice,
        pct: '100.0',
        pathData: fullCirclePathData,
      };
    }

    const startRad = (startAngle - 90) * (Math.PI / 180);
    const endRad = (endAngle - 90) * (Math.PI / 180);

    const x1 = center + outerRadius * Math.cos(startRad);
    const y1 = center + outerRadius * Math.sin(startRad);
    const x2 = center + outerRadius * Math.cos(endRad);
    const y2 = center + outerRadius * Math.sin(endRad);

    const x3 = center + innerRadius * Math.cos(endRad);
    const y3 = center + innerRadius * Math.sin(endRad);
    const x4 = center + innerRadius * Math.cos(startRad);
    const y4 = center + innerRadius * Math.sin(startRad);

    const largeArc = angle > 180 ? 1 : 0;

    const pathData = [
      `M ${x1.toFixed(2)} ${y1.toFixed(2)}`,
      `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
      `L ${x3.toFixed(2)} ${y3.toFixed(2)}`,
      `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${x4.toFixed(2)} ${y4.toFixed(2)}`,
      'Z',
    ].join(' ');

    return {
      ...slice,
      pct: pct.toFixed(1),
      pathData,
    };
  });
};
