-- seed-test-places.sql — 20 spread-out test places to verify world-zoom
-- clustering (Phase 1 acceptance criterion). Run in the SQL editor as needed;
-- delete them afterward with the companion statement at the bottom.
-- created_by is left null; inserting via the SQL editor uses service_role.

insert into public.places (name, country, admin1, lat, lng, first_visit) values
  ('Lisbon',        'Portugal',     'Lisboa',          38.7223,   -9.1393, '2024-05-02'),
  ('Porto',         'Portugal',     'Porto',           41.1579,   -8.6291, '2024-05-06'),
  ('Barcelona',     'Spain',        'Catalonia',       41.3874,    2.1686, '2023-09-10'),
  ('Paris',         'France',       'Île-de-France',   48.8566,    2.3522, '2023-06-01'),
  ('Rome',          'Italy',        'Lazio',           41.9028,   12.4964, '2022-10-11'),
  ('Reykjavik',     'Iceland',      'Capital Region',  64.1466,  -21.9426, '2024-01-20'),
  ('London',        'United Kingdom','England',         51.5074,   -0.1278, '2023-03-15'),
  ('Marrakesh',     'Morocco',      'Marrakesh-Safi',  31.6295,   -7.9811, '2022-11-04'),
  ('Cape Town',     'South Africa', 'Western Cape',   -33.9249,   18.4241, '2019-12-22'),
  ('Nairobi',       'Kenya',        'Nairobi',         -1.2921,   36.8219, '2018-08-08'),
  ('Tokyo',         'Japan',        'Tokyo',           35.6762,  139.6503, '2019-04-01'),
  ('Kyoto',         'Japan',        'Kyoto',           35.0116,  135.7681, '2019-04-05'),
  ('Bangkok',       'Thailand',     'Bangkok',         13.7563,  100.5018, '2018-02-14'),
  ('Sydney',        'Australia',    'New South Wales', -33.8688,  151.2093, '2017-11-30'),
  ('Queenstown',    'New Zealand',  'Otago',          -45.0312,  168.6626, '2017-12-10'),
  ('New York',      'United States','New York',         40.7128,  -74.0060, '2021-07-04'),
  ('Mexico City',   'Mexico',       'CDMX',             19.4326,  -99.1332, '2016-03-19'),
  ('Lima',          'Peru',         'Lima',           -12.0464,  -77.0428, '2016-03-25'),
  ('Rio de Janeiro','Brazil',       'Rio de Janeiro', -22.9068,  -43.1729, '2015-01-09'),
  ('Vancouver',     'Canada',       'British Columbia',49.2827, -123.1207, '2021-08-15');

-- Cleanup when done testing:
-- delete from public.places where created_by is null and name in (
--   'Lisbon','Porto','Barcelona','Paris','Rome','Reykjavik','London','Marrakesh',
--   'Cape Town','Nairobi','Tokyo','Kyoto','Bangkok','Sydney','Queenstown',
--   'New York','Mexico City','Lima','Rio de Janeiro','Vancouver');
