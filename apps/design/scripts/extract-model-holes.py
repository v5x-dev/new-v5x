"""Extract square hole boundaries from the included, axis-aligned GLB models.

This checks digital geometry, not physical manufacturing dimensions. Each face
keeps its outward normal so mating surfaces coincide without overlapping sheets.
"""

import collections
import json
import math
import struct
from pathlib import Path


def extract(path):
    binary = path.read_bytes()
    json_size = struct.unpack_from('<I', binary, 12)[0]
    document = json.loads(binary[20:20 + json_size])
    buffer_start = 28 + json_size

    def accessor(index):
        item = document['accessors'][index]
        view = document['bufferViews'][item['bufferView']]
        component = {5126: 'f', 5125: 'I', 5123: 'H'}[item['componentType']]
        components = {'SCALAR': 1, 'VEC3': 3}[item['type']]
        size = struct.calcsize(component) * components
        stride = view.get('byteStride', size)
        offset = (
            buffer_start
            + view.get('byteOffset', 0)
            + item.get('byteOffset', 0)
        )
        return [
            struct.unpack_from(
                '<' + component * components, binary, offset + row * stride
            )
            for row in range(item['count'])
        ]

    if any('matrix' in node or node.get('children') for node in document['nodes']):
        raise ValueError('Hole extraction requires flat nodes with TRS transforms')

    groups = collections.defaultdict(list)
    for node in document['nodes']:
        if 'mesh' not in node:
            continue
        rotation = node.get('rotation', [0, 0, 0, 1])
        translation = node.get('translation', [0, 0, 0])
        scale = node.get('scale', [1, 1, 1])

        def transform(vertex):
            vertex = [vertex[axis] * scale[axis] for axis in range(3)]
            x, y, z, w = rotation
            vx, vy, vz = vertex
            tx = 2 * (y * vz - z * vy)
            ty = 2 * (z * vx - x * vz)
            tz = 2 * (x * vy - y * vx)
            cross = [y * tz - z * ty, z * tx - x * tz, x * ty - y * tx]
            return tuple(
                round(
                    (vertex[axis] + w * [tx, ty, tz][axis]
                     + cross[axis] + translation[axis]) / 0.0254,
                    5,
                )
                for axis in range(3)
            )

        for primitive in document['meshes'][node['mesh']]['primitives']:
            vertices = list(map(
                transform, accessor(primitive['attributes']['POSITION'])
            ))
            indices = [row[0] for row in accessor(primitive['indices'])]
            for index in range(0, len(indices), 3):
                triangle = [
                    vertices[vertex] for vertex in indices[index:index + 3]
                ]
                left = [
                    triangle[1][axis] - triangle[0][axis] for axis in range(3)
                ]
                right = [
                    triangle[2][axis] - triangle[0][axis] for axis in range(3)
                ]
                normal = [
                    left[1] * right[2] - left[2] * right[1],
                    left[2] * right[0] - left[0] * right[2],
                    left[0] * right[1] - left[1] * right[0],
                ]
                length = math.sqrt(sum(value * value for value in normal))
                if length < 1e-10:
                    continue
                axis = max(
                    range(3), key=lambda candidate: abs(normal[candidate])
                )
                if abs(normal[axis]) / length < 0.99999:
                    continue
                key = (
                    axis, round(triangle[0][axis], 4),
                    1 if normal[axis] > 0 else -1,
                )
                groups[key].append(triangle)

    holes = []
    for (axis, _plane, sign), triangles in groups.items():
        # Interior triangulation edges occur twice. Face boundary edges occur once.
        edges = collections.Counter(
            tuple(sorted([triangle[index], triangle[(index + 1) % 3]]))
            for triangle in triangles
            for index in range(3)
        )
        adjacency = collections.defaultdict(set)
        for (left, right), count in edges.items():
            if count == 1:
                adjacency[left].add(right)
                adjacency[right].add(left)

        while adjacency:
            pending = [next(iter(adjacency))]
            seen = set()
            while pending:
                vertex = pending.pop()
                if vertex in seen:
                    continue
                seen.add(vertex)
                pending.extend(adjacency.get(vertex, []))
            # Only closed contours with a square boundary qualify as hole faces.
            closed = all(len(adjacency[vertex]) == 2 for vertex in seen)
            for vertex in seen:
                adjacency.pop(vertex, None)
            minimum = [
                min(vertex[component] for vertex in seen)
                for component in range(3)
            ]
            maximum = [
                max(vertex[component] for vertex in seen)
                for component in range(3)
            ]
            widths = [
                maximum[component] - minimum[component]
                for component in range(3) if component != axis
            ]
            if closed and all(0.17 < width < 0.20 for width in widths):
                center = [
                    round((minimum[component] + maximum[component]) / 2, 5)
                    for component in range(3)
                ]
                normal = [0, 0, 0]
                normal[axis] = sign
                holes.append({'center': center, 'axis': normal, 'type': 'square'})

    return sorted(holes, key=lambda hole: (hole['axis'], hole['center']))


def main():
    root = Path(__file__).resolve().parents[1] / 'public'
    model_root = root / 'models/vex-v5rc-parts'
    paths = sorted((model_root / 'angles').rglob('*.glb'))
    paths += sorted((model_root / 'c-channels').rglob('*.glb'))
    result = {}
    for path in paths:
        holes = extract(path)
        print(path.name, len(holes), 'hole faces')
        if holes:
            result['/' + str(path.relative_to(root))] = [
                hole['center'] + hole['axis'] for hole in holes
            ]
    output = root.parent / 'src/lib/model-holes.json'
    output.write_text(json.dumps(result, separators=(',', ':')) + '\n')


if __name__ == '__main__':
    main()
