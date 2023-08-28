import type { Tree, TreeChild, TreeWithLayout } from './types'

export interface WrappedTreeWithLayout {
	readonly tree: Readonly<TreeWithLayout>
	readonly mX: number
	readonly mY: number
}

const M = Math.max
const C = 'children'

const _computeNaiveLayout = (
	tree: Tree,
	depth = 0,
	// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
	counters: { l: number[]; mX: number },
): Readonly<TreeWithLayout> => {
	const l = counters.l
	const x = (l[depth] ?? -1) + 1
	l[depth] = x
	counters.mX = M(counters.mX, x)

	const tc = tree[C]
	return {
		data: tree.data,
		children: tc?.map((child: Readonly<TreeChild>) => ({
			eData: child.eData,
			node: _computeNaiveLayout(child.node, depth + 1, counters),
		})),
		meta: {
			isRoot: depth === 0,
			isLeaf: tc === undefined || tc.length === 0,
			pos: { x, y: depth },
		},
	} satisfies Readonly<TreeWithLayout>
}

export const computeNaiveLayout = (
	tree: Readonly<Tree>,
): Readonly<WrappedTreeWithLayout> => {
	const counters = { l: [], mX: 0 }
	return {
		tree: _computeNaiveLayout(tree, 0, counters),
		mX: counters.mX,
		mY: counters.l.length - 1,
	}
}

type DeepWriteable<T> = { -readonly [P in keyof T]: DeepWriteable<T[P]> }

const _addMods = (
	// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
	{ meta, children }: DeepWriteable<TreeWithLayout>,
	modsum = 0,
	// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
	tracer: { mX: number },
): void => {
	meta.pos.x += modsum
	tracer.mX = M(tracer.mX, meta.pos.x)
	// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
	modsum += meta.m! // We know it's defined because we control when it's called
	for (const child of children ?? []) {
		_addMods(child.node, modsum, tracer)
	}
}

const _getPosX = (v: { readonly node: Readonly<TreeWithLayout> }): number => {
	return v.node.meta.pos.x
}

const _computeSmartLayout = (
	tree: Tree,
	depth = 0,
	// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
	offsets: number[],
	// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
	tracer: { mX: number },
): DeepWriteable<TreeWithLayout> => {
	const tc = tree[C]
	const children = tc?.map((child) => ({
		eData: child.eData,
		node: _computeSmartLayout(child.node, depth + 1, offsets, tracer),
	}))

	let x: number
	let m = 0
	const numChildren = tc?.length ?? 0
	if (numChildren === 0) {
		x = offsets[depth] ?? 0
	} else if (numChildren === 1) {
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		x = _getPosX(children![0]!)
	} else {
		const c = // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			(_getPosX(children![0]!) +
				// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
				_getPosX(children![numChildren - 1]!)) *
			0.5
		x = M(offsets[depth] ?? 0, c)
		m = x - c
	}
	tracer.mX = M(tracer.mX, x)
	offsets[depth] = 1 + x

	return {
		data: tree.data,
		children,
		meta: {
			isRoot: depth === 0,
			isLeaf: tc === undefined || tc.length === 0,
			pos: { x, y: depth },
			m,
		},
	} satisfies Readonly<TreeWithLayout> as DeepWriteable<TreeWithLayout>
}

const _inPlaceEvenSpacingUpdate = (
	numChildren: number,
	// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
	tree: DeepWriteable<TreeWithLayout>,
	shift: number,
	// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
	offsets: number[],
	depth: number,
	// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
	tracer: { mX: number },
): void => {
	const tm = tree.meta
	const tmp = tm.pos
	if (numChildren === 0) {
		tmp.x += shift
	} else if (numChildren === 1) {
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		tmp.x = _getPosX(tree[C]![0]!)
	} else {
		const c = // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			(_getPosX(tree[C]![0]!) +
				// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
				_getPosX(tree[C]![numChildren - 1]!)) *
			0.5
		tmp.x = M(offsets[depth] ?? 0, c)
	}
	delete tm.m
	tracer.mX = M(tracer.mX, tmp.x)
	offsets[depth] = 1 + tmp.x
}

const _siblingsEvenSpacing = (
	// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
	tree: DeepWriteable<TreeWithLayout>,
	// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
	offsets: number[],
	// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
	tracer: { mX: number },
	depth = 0,
	shift = 0,
	// eslint-disable-next-line sonarjs/cognitive-complexity
): void => {
	const tc = tree[C]
	const numChildren = tc?.length ?? 0
	let lastFixedIdx: number | undefined
	let maxSpacing = 1
	for (const [idx, { node }] of (tc ?? []).entries()) {
		const isFixed = (node[C]?.length ?? 0) > 0
		if (isFixed) {
			if (lastFixedIdx !== undefined) {
				const spacing =
					(node.meta.pos.x -
						// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
						_getPosX(tc![lastFixedIdx]!)) /
					(idx - lastFixedIdx)
				maxSpacing = M(maxSpacing, spacing)
			}
			lastFixedIdx = idx
		}
	}

	let accShift = shift
	for (const [idx, { node }] of (tc ?? []).entries()) {
		if (idx === 0) {
			if (numChildren > 1) {
				accShift = M(
					0,
					shift +
						// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
						_getPosX(tc![1]!) -
						maxSpacing -
						node.meta.pos.x,
				)
			}
		} else {
			accShift =
				shift +
				M(
					0,
					// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
					_getPosX(tc![idx - 1]!) + maxSpacing - node.meta.pos.x,
				)
		}
		_siblingsEvenSpacing(node, offsets, tracer, depth + 1, accShift)
	}

	_inPlaceEvenSpacingUpdate(numChildren, tree, shift, offsets, depth, tracer)
}

const _cousinsEvenSpacing = (
	// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
	tree: DeepWriteable<TreeWithLayout>,
	// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
	offsets: number[],
	// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
	tracer: { mX: number },
	depth = 0,
	shift = 0,
): void => {
	const tc = tree[C]
	const numChildren = tc?.length ?? 0

	const nextOffset = offsets[depth + 1]
	let accShift = shift
	if (
		numChildren >= 2 &&
		nextOffset !== undefined &&
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		(tc![0]!.node[C]?.length ?? 0) === 0
	) {
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		const mid = _getPosX(tc![1]!) - 1
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		accShift = shift + M(0, mid - _getPosX(tc![0]!))
	}

	for (const [idx, { node }] of (tc ?? []).entries()) {
		if (idx === 0) {
			_cousinsEvenSpacing(node, offsets, tracer, depth + 1, accShift)
		} else {
			_cousinsEvenSpacing(node, offsets, tracer, depth + 1, shift)
		}
	}

	_inPlaceEvenSpacingUpdate(numChildren, tree, shift, offsets, depth, tracer)
}

export const computeSmartLayout = (
	tree: Readonly<Tree>,
): Readonly<WrappedTreeWithLayout> => {
	const offsets: number[] = []
	const tracer = { mX: 0 }

	const t = _computeSmartLayout(tree, 0, offsets, tracer)
	_addMods(t, 0, tracer)

	_cousinsEvenSpacing(t, [], tracer)
	_siblingsEvenSpacing(t, [], tracer)

	return {
		tree: t,
		mY: offsets.length - 1,
		mX: tracer.mX,
	}
}
