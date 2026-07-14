import { FilterDisclosure } from 'taste-engine-site';

const canvas: React.CSSProperties = {
  background: 'var(--background, #030504)',
  color: 'var(--text-primary, #eceeeb)',
  padding: 24,
  maxWidth: 360,
};

function Fields() {
  return (
    <>
      <label style={{ display: 'block', margin: '8px 0' }}>
        Sort
        <select style={{ marginLeft: 8 }} defaultValue="fit">
          <option value="fit">Personal fit</option>
          <option value="date">Date</option>
        </select>
      </label>
      <label style={{ display: 'block', margin: '8px 0' }}>
        <input type="checkbox" /> Low hassle only
      </label>
    </>
  );
}

export function WithActiveFilters() {
  return (
    <div style={canvas}>
      <FilterDisclosure count={2}>
        <Fields />
      </FilterDisclosure>
    </div>
  );
}

export function NoActiveFilters() {
  return (
    <div style={canvas}>
      <FilterDisclosure count={0}>
        <Fields />
      </FilterDisclosure>
    </div>
  );
}
