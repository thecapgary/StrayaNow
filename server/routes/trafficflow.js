const express = require('express');
const https = require('https');
const router = express.Router();

// Representative road sample points — one per major road segment across Tasmania
const ROAD_POINTS = {
  tasmania: [
    // Hobart city roads
    { lat: -42.882, lon: 147.327, desc: 'Hobart CBD'         },
    { lat: -42.853, lon: 147.326, desc: 'Brooker Hwy'        },
    { lat: -42.911, lon: 147.311, desc: 'Southern Outlet'    },
    { lat: -42.840, lon: 147.285, desc: 'Glenorchy'          },
    // Tasman Highway (A3) — Hobart east to coast
    { lat: -42.861, lon: 147.357, desc: 'Tasman Bridge'      },
    { lat: -42.841, lon: 147.388, desc: 'Mornington'         },
    { lat: -42.848, lon: 147.432, desc: 'Tasman Hwy (East)'  },
    { lat: -42.783, lon: 147.566, desc: 'Sorell Causeway'    },
    // Midland Highway south → north
    { lat: -42.713, lon: 147.255, desc: 'Brighton'           },
    { lat: -42.524, lon: 147.197, desc: 'Kempton'            },
    { lat: -42.302, lon: 147.367, desc: 'Oatlands'           },
    { lat: -41.882, lon: 147.489, desc: 'Ross'               },
    { lat: -41.924, lon: 147.496, desc: 'Campbell Town'      },
    // Launceston
    { lat: -41.434, lon: 147.137, desc: 'Launceston CBD'     },
    { lat: -41.462, lon: 147.145, desc: 'South Launceston'   },
    { lat: -41.512, lon: 147.093, desc: 'Western Junction'   },
    // Bass Highway: Launceston → NW coast
    { lat: -41.531, lon: 146.837, desc: 'Westbury'           },
    { lat: -41.523, lon: 146.653, desc: 'Deloraine'          },
    { lat: -41.178, lon: 146.360, desc: 'Devonport'          },
    { lat: -41.053, lon: 145.911, desc: 'Burnie'             },
    { lat: -40.989, lon: 145.727, desc: 'Wynyard'            },
    // East Coast
    { lat: -41.871, lon: 148.297, desc: 'Bicheno'            },
    { lat: -41.322, lon: 148.246, desc: 'St Helens'          },
    // Huon Valley
    { lat: -43.031, lon: 147.030, desc: 'Huonville'          },
  ],
  hobart: [
    { lat: -42.882, lon: 147.327, desc: 'Hobart CBD'         },
    { lat: -42.853, lon: 147.326, desc: 'Brooker Hwy'        },
    { lat: -42.911, lon: 147.311, desc: 'Southern Outlet'    },
    { lat: -42.840, lon: 147.285, desc: 'Glenorchy'          },
    { lat: -42.861, lon: 147.357, desc: 'Tasman Bridge'      },
    { lat: -42.841, lon: 147.388, desc: 'Mornington'         },
    { lat: -42.848, lon: 147.432, desc: 'Tasman Hwy (East)'  },
  ],
  launceston: [
    { lat: -41.434, lon: 147.137, desc: 'Launceston CBD'     },
    { lat: -41.462, lon: 147.145, desc: 'South Launceston'   },
    { lat: -41.512, lon: 147.093, desc: 'Western Junction'   },
    { lat: -41.531, lon: 146.837, desc: 'Westbury'           },
  ],
};

const CACHE = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function tomtomGet(lat, lon, key) {
  return new Promise((resolve) => {
    const url = `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point=${lat},${lon}&unit=KMPH&key=${key}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

function congestionColor(ratio) {
  if (ratio >= 0.85) return '#4caf50'; // green  — free flow
  if (ratio >= 0.60) return '#ff9800'; // amber  — moderate
  return '#f44336';                    // red    — congested
}

// GET /api/trafficflow?city=tasmania
router.get('/', async (req, res) => {
  const key = process.env.TOMTOM_KEY;
  if (!key) return res.status(503).json({ error: 'TOMTOM_KEY not configured' });

  const city = (req.query.city || 'tasmania').toLowerCase();
  const cacheKey = city;

  if (CACHE[cacheKey] && Date.now() - CACHE[cacheKey].ts < CACHE_TTL) {
    return res.json(CACHE[cacheKey].data);
  }

  const points = ROAD_POINTS[city] || ROAD_POINTS.tasmania;

  const results = await Promise.all(
    points.map(p => tomtomGet(p.lat, p.lon, key).then(d => ({ point: p, d })))
  );

  const segments = [];
  for (const { point, d } of results) {
    const seg = d?.flowSegmentData;
    if (!seg || seg.roadClosure) continue;
    const ratio = seg.freeFlowSpeed > 0
      ? Math.min(1, seg.currentSpeed / seg.freeFlowSpeed)
      : 1;
    segments.push({
      lat: point.lat,
      lon: point.lon,
      desc: point.desc,
      currentSpeed:   seg.currentSpeed,
      freeFlowSpeed:  seg.freeFlowSpeed,
      ratio,
      color:          congestionColor(ratio),
      frc:            seg.frc,
      // Road geometry TomTom matched to — used to place particles accurately
      coords: (seg.coordinates?.coordinate || []).map(c => [c.longitude, c.latitude]),
    });
  }

  CACHE[cacheKey] = { ts: Date.now(), data: segments };
  console.log(`[traffic] TomTom flow fetched: ${segments.length} road points for ${city}`);
  res.json(segments);
});

module.exports = router;
